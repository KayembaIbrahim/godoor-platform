#!/usr/bin/env node
/**
 * Scan every blob introduced by the unpushed commit range for credential
 * patterns. Used to prove a history rewrite actually scrubbed everything
 * GitHub push protection flagged (and the things it does not detect).
 *
 * Usage: node scripts/scan-unpushed-secrets.mjs [base..head]
 *   Defaults to origin/main..HEAD
 */
import { execFileSync, spawnSync } from "node:child_process";

const range = process.argv[2] || "origin/main..HEAD";

const PATTERNS = [
  ["vercel-pat", /\bvcp_[A-Za-z0-9]{20,}/g],
  ["supabase-pat", /\bsbp_[A-Za-z0-9]{20,}/g],
  ["cloudflare-token", /\bcfat_[A-Za-z0-9]{20,}/g],
  ["github-token", /\b(?:gho|ghp|ghs|ghr)_[A-Za-z0-9]{20,}/g],
  ["github-pat", /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["google-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ["openai-key", /\bsk-[A-Za-z0-9]{32,}/g],
  ["mapbox-secret", /\bsk\.eyJ[A-Za-z0-9_\-]{20,}/g],
  ["supabase-jwt", /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{20,}/g],
  ["pg-url", /\bpostgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@[^\s"']+/g],
  // Passwords and admin path secrets do not carry a vendor prefix, so a
  // prefix-based scan alone misses them. These are matched on the shape they
  // take in this repo's own scripts. `KayembaIbrahim` is a GitHub username
  // and is deliberately not matched.
  ["script-password", /\b[Kk]ayemba(?: [@b]?[A-Za-z0-9]{1,12}|@256)\b/g],
  ["admin-path-secret", /\bgdr-[a-f0-9]{32}\b/g],
];

const objects = execFileSync("git", ["rev-list", "--objects", range], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const sp = line.indexOf(" ");
    return { sha: sp === -1 ? line : line.slice(0, sp), path: sp === -1 ? "(no path)" : line.slice(sp + 1) };
  });

// One batched --batch-check to learn which objects are blobs.
const check = spawnSync("git", ["cat-file", "--batch-check"], {
  input: objects.map((o) => o.sha).join("\n") + "\n",
  maxBuffer: 256 * 1024 * 1024,
  encoding: "utf8",
});
const pathOf = new Map();
const blobShas = [];
for (const line of (check.stdout || "").split("\n")) {
  const [sha, type, size] = line.split(" ");
  if (type !== "blob") continue;
  blobShas.push(sha);
  const obj = objects.find((o) => o.sha === sha);
  if (obj && !pathOf.has(sha)) pathOf.set(sha, obj.path);
}

const found = new Map();
const literals = new Map();

if (blobShas.length) {
  const res = spawnSync("git", ["cat-file", "--batch"], {
    input: blobShas.join("\n") + "\n",
    maxBuffer: 512 * 1024 * 1024,
    encoding: null,
  });
  const buf = res.stdout || Buffer.alloc(0);
  let off = 0;
  while (off < buf.length) {
    const nl = buf.indexOf(0x0a, off);
    if (nl === -1) break;
    const parts = buf.toString("utf8", off, nl).split(" ");
    const sha = parts[0];
    const size = parseInt(parts[2], 10);
    const start = nl + 1;
    const content = buf.toString("utf8", start, start + size);
    off = start + size + 1; // skip the trailing newline git emits
    if (!content || content.length > 4_000_000) continue;
    const path = pathOf.get(sha) || "(unknown)";
    for (const [name, re] of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const literal = m[0];
        const key = `${name}|${literal}`;
        if (!found.has(key)) {
          found.set(key, { pattern: name, path, count: 0 });
          literals.set(literal, name);
        }
        found.get(key).count += 1;
        if (literal.length === 0) re.lastIndex += 1;
      }
    }
  }
}

const rows = [...found.values()].sort((a, b) => a.pattern.localeCompare(b.pattern) || a.path.localeCompare(b.path));
console.log(`scanned range ${range}: ${objects.length} objects, ${blobShas.length} blobs`);
if (rows.length === 0) {
  console.log("CLEAN: no credential patterns found");
} else {
  console.log(`FOUND ${rows.length} distinct secret literals:\n`);
  for (const r of rows) {
    console.log(`  ${r.pattern.padEnd(20)} ${String(r.count).padStart(3)}x  ${r.path}`);
  }
}

if (process.env.DUMP_SECRETS === "1") {
  console.log("\n--- literals ---");
  for (const [lit, label] of literals) console.log(`${label}\t${lit}`);
}
