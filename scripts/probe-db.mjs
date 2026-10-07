/**
 * Read-only probe of the live Supabase project. Used to ground bug reports in
 * real data (which tables exist, what rows are in them) before changing code.
 *
 * Run: node scripts/probe-db.mjs
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path, opts = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H, ...opts });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text.slice(0, 300); }
  return { status: res.status, json };
}

const TABLES = [
  "merchants", "products", "orders", "profiles", "wallets", "ledger_entries",
  "deposits", "escrow_holds", "riders", "rider_locations", "ride_requests",
  "payments", "chat_messages", "fee_config", "provider_locations", "clinic_queue",
  "app_settings", "phone_change_requests", "morse_deposits",
];

const out = {};
for (const t of TABLES) {
  const { status, json } = await rest(`${t}?select=*&limit=200`);
  out[t] = { status, count: Array.isArray(json) ? json.length : null, rows: json };
}

fs.writeFileSync("scripts/.db-probe.json", JSON.stringify(out, null, 2));
for (const [t, v] of Object.entries(out)) {
  console.log(`${t.padEnd(22)} HTTP ${String(v.status).padEnd(4)} ${Array.isArray(v.rows) ? `${v.rows.length} rows` : JSON.stringify(v.rows).slice(0, 90)}`);
}