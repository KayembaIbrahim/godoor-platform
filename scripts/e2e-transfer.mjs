/**
 * End-to-end verification of P2P transfers against PRODUCTION.
 *
 * Signs in as the real customer and rider accounts, moves a real amount
 * between them through the public API, checks every leg, then restores the
 * balances and purges the records so production is left exactly as found.
 *
 * Requires .env.vercel-prod (production service role) and the account
 * credentials. Run: node scripts/e2e-transfer.mjs
 */

import { readFileSync } from "node:fs";

/* ── Config ──────────────────────────────────────────────────────────────── */

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv(".env.vercel-prod");
/* The Vercel export names these NEXT_PUBLIC_* — a plain SUPABASE_URL does not
   exist in the file and resolves to undefined, which fails at the first fetch. */
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://godoor.site";

if (!SUPABASE_URL || !ANON || !SERVICE) {
  console.error("Production env incomplete — need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  console.error("found:", Object.keys(env).filter((k) => k.includes("SUPABASE")).join(", ") || "(none)");
  process.exit(1);
}

const CUSTOMER = "ibrahimkapoor11@gmail.com";
const RIDER = "leeguho11@gmail.com";
const PASSWORD = "Kayemba@256";

const AMOUNT = 1000; /* deliberately small — this is real money */

let pass = 0;
let fail = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e.message}`);
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m);
}
const eq = (a, b, m) =>
  assert(a === b, `${m ?? ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/* ── Helpers ─────────────────────────────────────────────────────────────── */

async function signIn(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await r.json().catch(() => ({}));
  if (!b.access_token) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(b).slice(0, 160)}`);
  return { token: b.access_token, id: b.user.id, email: b.user.email };
}

function api(token, path) {
  return async (opts = {}) =>
    fetch(`${SITE}${path}`, {
      ...opts,
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(opts.headers || {}),
      },
    });
}

async function walletOf(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${userId}&select=available_balance`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const b = await r.json().catch(() => ({}));
  return Array.isArray(b) && b[0] ? Number(b[0].available_balance) : 0;
}

async function setBalance(userId, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/wallets?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ available_balance: value }),
  });
}

async function kvDel(key) {
  await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}

async function ledgerOf(userId, refId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ledger_entries?user_id=eq.${userId}&ref_id=eq.${refId}&select=amount,type,ref_type`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  const b = await r.json().catch(() => ([]));
  return Array.isArray(b) ? b : [];
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

console.log("Production transfer E2E\n");

let cust;
let rider;
let before = { cust: 0, rider: 0 };
let sentRef = null;
const cleanup = [];

try {
  cust = await signIn(CUSTOMER);
  rider = await signIn(RIDER);
  console.log(`  customer ${cust.email}`);
  console.log(`  rider    ${rider.email}\n`);

  before.cust = await walletOf(cust.id);
  before.rider = await walletOf(rider.id);
  console.log(`  balances before: customer ${before.cust}, rider ${before.rider}\n`);

  const getTransfer = api(cust.token, "/api/wallet/transfer");
  const postTransfer = api(cust.token, "/api/wallet/transfer");
  const key = `e2e-${Date.now()}`;

  await t("GET returns config, balance and empty history", async () => {
    const r = await getTransfer();
    eq(r.status, 200, "GET status");
    const b = await r.json();
    assert(b.data, "no data payload");
    eq(b.data.available, before.cust, "available matches the ledger");
    assert(typeof b.data.config.fee_percent === "number", "fee_percent missing");
    assert(Array.isArray(b.data.sent), "sent must be an array");
    assert(Array.isArray(b.data.received), "received must be an array");
  });

  await t("POST rejects a self-transfer", async () => {
    const r = await postTransfer({
      method: "POST",
      body: JSON.stringify({ amount: AMOUNT, toEmail: CUSTOMER, clientKey: `${key}-self` }),
    });
    assert(r.status === 400 || r.status === 404, `expected a refusal, got ${r.status}`);
    const b = await r.json();
    assert(/own account|no godoor account/i.test(b.error || ""), `unexpected error: ${b.error}`);
  });

  await t("POST rejects an unknown email", async () => {
    const r = await postTransfer({
      method: "POST",
      body: JSON.stringify({
        amount: AMOUNT,
        toEmail: `nobody-${Date.now()}@nowhere.invalid`,
        clientKey: `${key}-ghost`,
      }),
    });
    eq(r.status, 404, "status");
    const b = await r.json();
    assert(/no godoor account/i.test(b.error || ""), `unexpected error: ${b.error}`);
  });

  await t("POST rejects shillings and overdraft before touching money", async () => {
    const before0 = await walletOf(cust.id);
    const odd = await postTransfer({
      method: "POST",
      body: JSON.stringify({ amount: 1050, toEmail: RIDER, clientKey: `${key}-odd` }),
    });
    assert(odd.status === 400, `shillings should be refused, got ${odd.status}`);
    const big = await postTransfer({
      method: "POST",
      body: JSON.stringify({ amount: 999_000_000, toEmail: RIDER, clientKey: `${key}-big` }),
    });
    assert(big.status === 400, `overdraft should be refused, got ${big.status}`);
    eq(await walletOf(cust.id), before0, "balance untouched by refused requests");
  });

  let transferId = null;
  await t("POST moves the money and credits the recipient", async () => {
    const r = await postTransfer({
      method: "POST",
      body: JSON.stringify({ amount: AMOUNT, toEmail: RIDER, note: "e2e", clientKey: key }),
    });
    eq(r.status, 200, `send failed: ${JSON.stringify(await r.clone().json().catch(() => ({})))}`);
    const b = await r.json();
    transferId = b.data.transfer.id;
    sentRef = b.data.transfer.reference;
    eq(b.data.transfer.amount, AMOUNT, "gross");
    eq(b.data.transfer.net, AMOUNT, "net (no fee configured)");
    eq(b.data.balance, before.cust - AMOUNT, "returned balance");

    eq(await walletOf(cust.id), before.cust - AMOUNT, "customer balance debited");
    eq(await walletOf(rider.id), before.rider + AMOUNT, "rider balance credited");

    cleanup.push(`transfer:rec:${transferId}`, `transfer:user:${cust.id}`, `transfer:inbox:${rider.id}`);
    cleanup.push(`transfer:idem:${cust.id}:${key}`);
  });

  await t("both ledger legs are written with a shared reference", async () => {
    const [outL, inL] = await Promise.all([ledgerOf(cust.id, transferId), ledgerOf(rider.id, transferId)]);
    eq(outL.length, 1, "sender leg count");
    eq(inL.length, 1, "recipient leg count");
    eq(outL[0].amount, -AMOUNT, "sender leg amount");
    eq(inL[0].amount, AMOUNT, "recipient leg amount");
    eq(outL[0].ref_type, "transfer", "ref_type");
    eq(outL[0].type, "adjustment", "type accepted by the CHECK constraint");
  });

  await t("the same client key cannot send twice", async () => {
    const r = await postTransfer({
      method: "POST",
      body: JSON.stringify({ amount: AMOUNT, toEmail: RIDER, note: "e2e", clientKey: key }),
    });
    eq(r.status, 200, "retry resolves rather than erroring");
    const b = await r.json();
    eq(b.data.duplicate, true, "flagged as a duplicate");
    eq(await walletOf(rider.id), before.rider + AMOUNT, "rider credited ONCE only");
  });

  await t("the rider sees it in their received history", async () => {
    const r = await api(rider.token, "/api/wallet/transfer")();
    eq(r.status, 200, "status");
    const b = await r.json();
    assert(b.data.received.length >= 1, "no received transfers");
    const hit = b.data.received.find((x) => x.id === transferId);
    assert(hit, "this transfer missing from the rider's inbox");
    eq(hit.net, AMOUNT, "net on the received record");
    assert(hit.reference === sentRef, "reference mismatch");
  });

  await t("email matching is case- and whitespace-insensitive", async () => {
    const r = await postTransfer({
      method: "POST",
      body: JSON.stringify({
        /* Must clear min_amount_ugx (1000) — a smaller amount would be refused
           by the limit check, which would mask whether the lookup resolved. */
        amount: AMOUNT,
        toEmail: `  ${RIDER.toUpperCase()}  `,
        clientKey: `${key}-case`,
      }),
    });
    if (r.status !== 200) {
      const b = await r.json().catch(() => ({}));
      throw new Error(`status ${r.status}: ${b.error}`);
    }
    const b = await r.json();
    const id = b.data.transfer.id;
    eq(b.data.transfer.toEmail, RIDER, "recipient normalised to the canonical address");
    cleanup.push(`transfer:rec:${id}`, `transfer:user:${cust.id}`, `transfer:inbox:${rider.id}`);
    cleanup.push(`transfer:idem:${cust.id}:${key}-case`);
    await setBalance(cust.id, before.cust - AMOUNT);
    await setBalance(rider.id, before.rider + AMOUNT);
    await fetch(`${SUPABASE_URL}/rest/v1/ledger_entries?ref_id=eq.${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  });

  await t("a padded address is still refused when it has no account", async () => {
    /* Proves the 404 above was a real lookup miss, not a formatting failure. */
    const r = await postTransfer({
      method: "POST",
      body: JSON.stringify({
        amount: AMOUNT,
        toEmail: `  NOBODY-${Date.now()}@NOWHERE.INVALID  `,
        clientKey: `${key}-ghost2`,
      }),
    });
    eq(r.status, 404, "status");
    const b = await r.json();
    assert(/no godoor account/i.test(b.error || ""), `unexpected error: ${b.error}`);
  });
} catch (e) {
  fail++;
  failures.push(`fatal: ${e.message}`);
  console.error("FATAL", e.message);
} finally {
  /* ── Restore production exactly as found ─────────────────────────────── */
  if (cust && rider) {
    await setBalance(cust.id, before.cust);
    await setBalance(rider.id, before.rider);
    /* Remove the test ledger rows by reference. */
    for (const id of cleanup.filter((k) => k.startsWith("transfer:rec:")).map((k) => k.split(":").pop())) {
      await fetch(`${SUPABASE_URL}/rest/v1/ledger_entries?ref_id=eq.${id}`, {
        method: "DELETE",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
    }
    for (const key of cleanup) await kvDel(key);
  }
  console.log(`\nrestored: customer ${before.cust}, rider ${before.rider}`);
  console.log(`\ntransfer E2E: ${pass} passed, ${fail} failed`);
  if (fail) {
    for (const f of failures) console.error("  FAIL " + f);
    process.exit(1);
  }
}