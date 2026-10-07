/**
 * Applies a .sql file to the live Supabase project through the Management API.
 *
 * The app's own `exec_sql` RPC cannot run DDL (it is not SECURITY DEFINER and
 * does not own the tables), which is why every `ALTER TABLE ... ADD COLUMN IF
 * NOT EXISTS` helper in the code base silently did nothing. Schema changes have
 * to go through the Management API's database/query endpoint.
 *
 * Usage: node scripts/apply-sql.mjs SCHEMA_RECONCILIATION.sql
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const token = env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];
if (!token) { console.error("SUPABASE_ACCESS_TOKEN missing"); process.exit(1); }
if (!file) { console.error("usage: node scripts/apply-sql.mjs <file.sql>"); process.exit(1); }

/* TARGET SELECTION
 *
 * The workspace `.env.local` points at a DIFFERENT Supabase project than
 * production, so defaulting to it would silently apply schema to the wrong
 * database — and DDL is not something to apply twice to the wrong place.
 * `SUPABASE_PROJECT_REF` overrides it explicitly, and the script refuses to run
 * rather than guess which project it is about to change.
 */
const refFromUrl = env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./)?.[1];
const ref = process.env.SUPABASE_PROJECT_REF || refFromUrl;
if (!ref) {
  console.error(
    "Cannot determine the target project. Set SUPABASE_PROJECT_REF explicitly, " +
      "e.g. SUPABASE_PROJECT_REF=llzq… node scripts/apply-sql.mjs FILE.sql",
  );
  process.exit(1);
}
console.log(
  `Target project: ${ref} (${ref === refFromUrl ? "from .env.local" : "explicit override"})`,
);

const sql = fs.readFileSync(file, "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
fs.writeFileSync("scripts/.last-query-result.json", text);
console.log(text.length > 6000 ? `${text.slice(0, 6000)}\n…(full output in scripts/.last-query-result.json)` : text);