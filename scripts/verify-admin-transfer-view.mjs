/**
 * Proves the admin console's data path against PRODUCTION.
 *
 * The admin console is gated by a session cookie, so this exercises the exact
 * functions `GET /api/admin/transfers` calls rather than logging in: it sends a
 * real transfer through the public API, reads it back with `listAllTransfers`
 * and the config loader, checks the totals arithmetic, then restores balances
 * and purges every record it created.
 *
 * Run: node scripts/verify-admin-transfer-view.mjs
 */

import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd()}/scripts/`));
const {
  listAllTransfers,
  readTransferConfig,
  sumSentToday,
} = await import("../src/lib/transfer.ts");

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = loadEnv(".env.vercel-prod");
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://godoor.site";
const CUSTOMER = "ibrahimkapoor11@gmail.com";
const RIDER = "leeguho11@gmail.com";
const PASSWORD = "Kayemba@256";
const AMOUNT = 2000;

const SH = { apikey: S, Authorization: `Bearer ${S}`, "content-type": "application/json" };
let pass = 0, fail = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}: ${e.message}`); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/* Minimal service client shaped like the one the admin route uses. */
const sb = {
  from(t) {
    let path = `/${t}`;
    const sel = { value: null };
    const api = {
      select(c) { sel.value = c; api._sel = c; return api; },
      eq(k, v) { path += `${path.includes("?") ? "&" : "?"}${k}=eq.${encodeURIComponent(v)}`; return api; },
      like(k, v) { path += `${path.includes("?") ? "&" : "?"}${k}=like.${encodeURIComponent(v)}`; return api; },
      limit(n) { path += `&limit=${n}`; return api; },
      maybeSingle() { return run(`${U}/rest/v1${path}&select=${api._sel || "*"}`); },
      then(res) { return run(`${U}/rest/v1${path}&select=${api._sel || "*"}`).then(res); },
    };
    return api;
  },
};
async function run(url) {
  const r = await fetch(url, { headers: SH });
  const b = await r.json().catch(() => null);
  return { data: r.ok ? b : null, error: r.ok ? null : { message: String(r.status) } };
}

const bal = async (id) => {
  const r = await fetch(`${U}/rest/v1/wallets?user_id=eq.${id}&select=available_balance`, { headers: SH });
  const b = await r.json().catch(() => ({}));
  return Array.isArray(b) && b[0] ? Number(b[0].available_balance) : 0;
};
const setBal = (id, v) =>
  fetch(`${U}/rest/v1/wallets?user_id=eq.${id}`, { method: "PATCH", headers: SH, body: JSON.stringify({ available_balance: v }) });
const kvDel = (key) =>
  fetch(`${U}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}`, { method: "DELETE", headers: SH });
const ledDel = (ref) =>
  fetch(`${U}/rest/v1/ledger_entries?ref_id=eq.${ref}`, { method: "DELETE", headers: SH });

let cust, rider, before = { c: 0, r: 0 }, id = null, key = null;

try {
  const signIn = async (email) => {
    const r = await fetch(`${U}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const b = await r.json();
    if (!b.access_token) throw new Error(`sign-in failed: ${r.status}`);
    return { token: b.access_token, id: b.user.id };
  };
  cust = await signIn(CUSTOMER);
  rider = await signIn(RIDER);
  before = { c: await bal(cust.id), r: await bal(rider.id) };
  console.log(`  balances before: customer ${before.c}, rider ${before.r}\n`);

  await t("readTransferConfig resolves real values against production", async () => {
    const c = await readTransferConfig(sb);
    eq(typeof c.enabled, "boolean", "enabled");
    eq(typeof c.fee_percent, "number", "fee_percent");
    eq(typeof c.max_amount_ugx, "number", "max_amount_ugx");
  });

  await t("a real transfer appears in the admin ledger view", async () => {
    key = `adminview-${Date.now()}`;
    const r = await fetch(`${SITE}/api/wallet/transfer`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${cust.token}`, "content-type": "application/json" },
      body: JSON.stringify({ amount: AMOUNT, toEmail: RIDER, note: "admin view check", clientKey: key }),
    });
    eq(r.status, 200, "send failed");
    id = (await r.json()).data.transfer.id;

    const all = await listAllTransfers(sb, 300);
    const hit = all.find((x) => x.id === id);
    assert(hit, "the transfer is not in the admin ledger");
    eq(hit.fromEmail, CUSTOMER, "sender email");
    eq(hit.toEmail, RIDER, "recipient email");
    eq(hit.amount, AMOUNT, "gross");
    eq(hit.net, AMOUNT, "net");
    eq(hit.status, "completed", "status");
    assert(hit.reference.startsWith("TR-"), `reference looks wrong: ${hit.reference}`);
    assert(hit.createdAt, "missing timestamp");
  });

  await t("the ledger is newest-first, as the console renders it", async () => {
    const all = await listAllTransfers(sb, 300);
    for (let i = 1; i < all.length; i++) {
      if (all[i - 1].createdAt < all[i].createdAt) throw new Error("out of order at index " + i);
    }
  });

  await t("console totals arithmetic matches the records", async () => {
    const all = await listAllTransfers(sb, 300);
    const completed = all.filter((x) => x.status === "completed");
    const volume = completed.reduce((s, x) => s + x.net, 0);
    const fees = completed.reduce((s, x) => s + x.fee, 0);
    eq(volume, completed.reduce((s, x) => s + x.amount - x.fee, 0), "volume = sum(amount - fee)");
    eq(fees, completed.reduce((s, x) => s + Math.round((x.amount * x.feePercent) / 100), 0), "fees recompute");
    /* The daily-limit basis the API enforces must agree with the admin view. */
    eq(sumSentToday(all.filter((x) => x.fromUserId === cust.id)), AMOUNT, "daily sum for the sender");
  });

  await t("search fields the console filters on are populated", async () => {
    const all = await listAllTransfers(sb, 300);
    const hit = all.find((x) => x.id === id);
    for (const f of ["fromEmail", "toEmail", "reference", "note"]) {
      assert(typeof hit[f] === "string", `field ${f} is not a string`);
    }
    eq(hit.note, "admin view check", "note round-tripped");
  });
} catch (e) {
  fail++; failures.push(`fatal: ${e.message}`); console.error("FATAL", e.message);
} finally {
  if (cust && rider) {
    await setBal(cust.id, before.c);
    await setBal(rider.id, before.r);
    if (id) await ledDel(id);
    for (const k of [`transfer:rec:${id}`, `transfer:user:${cust.id}`, `transfer:inbox:${rider.id}`, `transfer:idem:${cust.id}:${key}`]) {
      if (k.includes("null")) continue;
      await kvDel(k);
    }
  }
  if (cust && rider) console.log(`\nrestored: customer ${before.c}, rider ${before.r}`);
  console.log(`\nadmin transfer view: ${pass} passed, ${fail} failed`);
  if (fail) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
}

function assert(c, m) { if (!c) throw new Error(m); }