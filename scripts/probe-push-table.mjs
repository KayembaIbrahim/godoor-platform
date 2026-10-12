// Read-only probe of push_subscriptions using the production service-role key.
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.vercel-prod", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: svc, Authorization: `Bearer ${svc}` };

const get = async (q) => {
  const r = await fetch(`${url}/rest/v1/push_subscriptions?${q}&limit=1`, { headers: H });
  return { status: r.status, body: await r.text() };
};

// Does the table exist at all? A control probe on a bogus column proves it.
const control = await get("select=definitely_not_a_column_xyz");
console.log(`control (bogus column) -> ${control.status}  ${control.body.slice(0, 110)}`);
console.log(`  table exists: ${control.status !== 404 ? "YES" : "NO (404 PGRST205)"}`);

// Real columns the upsert writes.
for (const c of ["user_id", "endpoint", "p256dh", "auth", "user_agent", "updated_at"]) {
  const r = await get(`select=${c}`);
  console.log(`  col ${c.padEnd(11)} -> ${r.status} ${r.ok ? "" : r.body.slice(0, 110)}`);
}

// How many subscriptions exist right now?
const r = await fetch(`${url}/rest/v1/push_subscriptions?select=endpoint,user_id&limit=5`, { headers: H });
const rows = await r.json();
console.log(`\nexisting rows: ${Array.isArray(rows) ? rows.length : "n/a"}`);
for (const row of Array.isArray(rows) ? rows : []) {
  console.log(`  user=${String(row.user_id).slice(0, 8)}… endpoint=${String(row.endpoint).slice(0, 60)}…`);
}

// web-push available for sending?
try {
  await import("web-push");
  console.log("web-push package: installed");
} catch {
  console.log("web-push package: MISSING");
}
