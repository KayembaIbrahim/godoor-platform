#!/usr/bin/env node
/**
 * Repair a damaged node_modules tree.
 *
 * The sandbox's disk filled up during an `npm install`, which left some
 * packages half-written: the runtime files landed but the trailing `.d.ts`
 * declarations and source maps did not, and in one case (@supabase/phoenix)
 * the ESM entry point was missing entirely — which broke the Next build with
 * a bare "module-not-found".
 *
 * This script re-fetches each affected package tarball from the registry and
 * copies any file that is missing or zero-length. It never overwrites a file
 * that already has content, so it is safe to re-run.
 *
 * Usage: node tools/repair-node-modules.mjs [package ...]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const modulesDir = path.join(root, "node_modules");

/** Every file a package tarball is expected to contain, from its own package.json "files" list is not reliable — use the tarball. */
function readPkgJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/** A package is damaged when a file the tarball ships is missing or empty. */
function findDamage(dir) {
  const damaged = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(dir, childRel));
        if (stat.size === 0) damaged.push({ rel: childRel, reason: "empty" });
      }
    }
  };
  walk("");
  return damaged;
}

function repairPackage(name) {
  const dir = path.join(modulesDir, name);
  const pkg = readPkgJson(dir);
  if (!pkg) {
    console.log(`  ! ${name}: not installed, skipping`);
    return false;
  }
  const version = pkg.version;
  const tarball = pkg.dist?.tarball ?? `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repair-"));
  const tgz = path.join(tmp, "pkg.tgz");
  try {
    execFileSync("curl", ["-sSfL", "--max-time", "120", "-o", tgz, tarball], { stdio: "pipe" });
    execFileSync("tar", ["-xzf", tgz, "-C", tmp], { stdio: "pipe" });
  } catch (err) {
    console.log(`  ! ${name}: could not fetch tarball (${err.message.split("\n")[0]})`);
    fs.rmSync(tmp, { recursive: true, force: true });
    return false;
  }

  const src = path.join(tmp, "package");
  let copied = 0;
  const copyMissing = (rel) => {
    const from = path.join(src, rel);
    const to = path.join(dir, rel);
    const exists = fs.existsSync(to);
    if (exists) {
      const size = fs.statSync(to).size;
      if (size > 0) return; // healthy — leave it alone
    }
    if (!fs.existsSync(from)) return; // not in the tarball
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  };

  const walk = (rel) => {
    const abs = path.join(src, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(childRel);
      } else if (entry.isFile()) {
        copyMissing(childRel);
      }
    }
  };
  walk("");

  fs.rmSync(tmp, { recursive: true, force: true });
  if (copied > 0) {
    console.log(`  + ${name}@${version}: restored ${copied} file(s)`);
    return true;
  }
  console.log(`  = ${name}@${version}: already complete`);
  return false;
}

/** Packages whose declared entry points are missing — the ones that break builds. */
function packagesWithMissingEntries() {
  const rootPkg = readPkgJson(root);
  const names = Object.keys({ ...(rootPkg?.dependencies ?? {}), ...(rootPkg?.devDependencies ?? {}) });
  const broken = [];
  for (const name of names) {
    const dir = path.join(modulesDir, name);
    const pkg = readPkgJson(dir);
    if (!pkg) {
      broken.push(name);
      continue;
    }
    for (const entry of [pkg.main, pkg.module, pkg.types].filter(Boolean)) {
      const file = path.join(dir, entry);
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
        broken.push(name);
        break;
      }
    }
  }
  return broken;
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : packagesWithMissingEntries();

if (targets.length === 0) {
  console.log("Nothing to repair — every direct dependency has its entry points.");
  process.exit(0);
}

console.log(`Repairing ${targets.length} package(s):`);
let repaired = 0;
for (const name of targets) {
  if (repairPackage(name)) repaired++;
}
console.log(`\nDone. Repaired ${repaired} package(s).`);
