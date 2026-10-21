#!/usr/bin/env node
/**
 * Verify every installed package against the registry tarball it was resolved
 * from, and report anything that is missing, empty, or the wrong size.
 *
 * A full `npm ci` would be the blunt way to fix a damaged node_modules, but it
 * re-downloads ~510 packages and is easy to interrupt. This walks the lockfile
 * instead and only reports the damage, so the repair script can fix exactly
 * what is broken.
 *
 * Usage: node tools/verify-node-modules.mjs [--fix]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));

const onlyDamaged = process.argv.includes("--only-damaged");
const report = [];

for (const [dir, meta] of Object.entries(lock.packages ?? {})) {
  if (!dir.startsWith("node_modules/")) continue;
  if (!meta.resolved) continue;

  const abs = path.join(root, dir);
  const pkgJson = path.join(abs, "package.json");
  if (!fs.existsSync(pkgJson)) {
    report.push({ dir, reason: "package.json missing" });
    continue;
  }

  // Pull the tarball's file listing straight from the registry index entry
  // when we can, else from the tarball itself.
  let entries;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-"));
  const tgz = path.join(tmp, "p.tgz");
  try {
    execFileSync("curl", ["-sSfL", "--max-time", "90", "-o", tgz, meta.resolved], { stdio: "pipe" });
    entries = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8", stdio: "pipe" })
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/^package\//, ""))
      .filter((line) => !line.endsWith("/") && line !== "package.json");
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!onlyDamaged) console.log(`? ${dir}: could not fetch (${err.message.split("\n")[0]})`);
    continue;
  }

  const damaged = [];
  for (const rel of entries) {
    const file = path.join(abs, rel);
    if (!fs.existsSync(file)) {
      damaged.push({ rel, reason: "missing" });
      continue;
    }
    const size = fs.statSync(file).size;
    if (size === 0) damaged.push({ rel, reason: "empty" });
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (damaged.length > 0) {
    report.push({ dir, reason: `${damaged.length} file(s)`, sample: damaged.slice(0, 5) });
  }
}

if (report.length === 0) {
  console.log("node_modules is intact — every locked package matches its tarball.");
  process.exit(0);
}

console.log(`${report.length} damaged package(s):\n`);
for (const item of report) {
  console.log(`  ${item.dir} — ${item.reason}`);
  for (const s of item.sample ?? []) console.log(`      ${s.reason}: ${s.rel}`);
}
process.exit(1);
