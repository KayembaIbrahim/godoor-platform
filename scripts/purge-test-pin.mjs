/**
 * Remove the wallet-security row created by UI testing.
 *
 * The production `wallet_security` table was never applied, so the row lives in
 * `app_settings` under `wallet_security:<user id>`. Leaving it would mean the
 * owner is locked out of a PIN they never chose — changing it needs the current
 * one. Prints the row first, then deletes only that key.
 */
import { readFileSync } from "node:fs";

function env(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const prod = env(".env.vercel-prod");
const URL_ = prod.NEXT_PUBLIC_SUPABASE_URL;
const KEY = prod.SUPABASE_SERVICE_ROLE_KEY;
const PREFIX = "wallet_security:";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const before = await fetch(`${URL_}/rest/v1/app_settings?select=key,updated_at`, { headers: H });
const rows = await before.json();
const mine = (Array.isArray(rows) ? rows : []).filter((r) => String(r.key).startsWith(PREFIX));

console.log(`wallet_security rows before: ${mine.length}`);
for (const r of mine) console.log(`  ${r.key}  (${r.updated_at})`);

if (mine.length) {
  const del = await fetch(
    `${URL_}/rest/v1/app_settings?key=in.(${mine.map((r) => `"${r.key}"`).join(",")})`,
    { method: "DELETE", headers: H },
  );
  console.log("delete status:", del.status, del.ok ? "OK" : await del.text());
}

const after = await fetch(`${URL_}/rest/v1/app_settings?select=key`, { headers: H });
const rows2 = await after.json();
const left = (Array.isArray(rows2) ? rows2 : []).filter((r) => String(r.key).startsWith(PREFIX));
console.log(`wallet_security rows after: ${left.length}`);
console.log(left.length === 0 ? "CLEAN — account is back to 'no PIN set'" : "STILL PRESENT");