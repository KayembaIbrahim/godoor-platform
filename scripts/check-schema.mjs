/**
 * Cross-checks every Supabase table name used in the code against the live
 * project, so schema drift is reported instead of failing silently at runtime.
 *
 * Run: node scripts/check-schema.mjs
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const spec = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
  headers: { ...H, Accept: "application/openapi+json" },
}).then((r) => r.json());

const live = new Set(
  Object.keys(spec.paths).filter((p) => !p.startsWith("/rpc/")).map((p) => p.replace(/^\//, "")),
);

const INTERNAL = new Set(["rpc", "openapi", "v1"]);
const used = new Map(); // table -> [files]

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const src = fs.readFileSync(p, "utf8");
    const add = (t) => {
      if (!t || INTERNAL.has(t)) return;
      if (!used.has(t)) used.set(t, new Set());
      used.get(t).add(p);
    };
    for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) add(m[1]);
    for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z_]+)["'`]/g)) add(`rpc:${m[1]}`);
    for (const m of src.matchAll(/\.schema\(\s*["'`]([a-z_]+)["'`]/g)) add(m[1]);
  }
}
walk("src");

const rpcLive = new Set(Object.keys(spec.paths).filter((p) => p.startsWith("/rpc/")).map((p) => p.replace("/rpc/", "")));

console.log("=== TABLES THE CODE USES THAT DO NOT EXIST ===");
let missing = 0;
for (const [t, files] of [...used].sort()) {
  if (t.startsWith("rpc:")) {
    const fn = t.slice(4);
    if (!rpcLive.has(fn)) { missing++; console.log(`  ✗ rpc ${fn}  ← ${[...files][0]}`); }
    continue;
  }
  if (!live.has(t)) {
    missing++;
    console.log(`  ✗ ${t.padEnd(24)} ← ${[...files].slice(0, 3).join(", ")}`);
  }
}

console.log(`\n=== TABLES IN THE DB NOTHING READS ===`);
for (const t of [...live].sort()) {
  if (!used.has(t)) console.log(`  • ${t}`);
}

console.log(`\n${missing} missing object(s). ${live.size} tables live.`);