/**
 * Live check: can a signed-in user reach /api/wallet/security at all?
 *
 * Reproduces the reported symptom — "Sign in to continue" while setting up a
 * wallet PIN — by calling the endpoint the way each caller actually does:
 *
 *   1. bare fetch, no Authorization header  → what WalletLock.tsx used to send
 *   2. with a Bearer token                  → what it must send
 *
 * Also confirms the app_settings fallback answers, since `wallet_security` does
 * not exist in production and a 503 would block enrolment just as hard.
 */
import { readFileSync } from "node:fs";

const env = readFileSync(".env.vercel-prod", "utf8");
const val = (k) => {
  const m = env.match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  if (!m) throw new Error(`missing ${k} in .env.vercel-prod`);
  return m[1].trim();
};
const SB_URL = val("NEXT_PUBLIC_SUPABASE_URL");
const ANON = val("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const EMAIL = process.env.GD_EMAIL;
const PASSWORD = process.env.GD_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("set GD_EMAIL / GD_PASSWORD");
  process.exit(2);
}

const SITE = "https://godoor.site";
const API = `${SITE}/api/wallet/security`;

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  ok ? pass++ : fail++;
};

const auth = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());

if (!auth.access_token) {
  console.error("sign-in failed:", JSON.stringify(auth).slice(0, 300));
  process.exit(2);
}
const tok = auth.access_token;
console.log(`signed in as ${auth.user?.email} (${auth.user?.id})\n`);

/* ── 1. What WalletLock used to send ─────────────────────────────────────── */
const bare = await fetch(API, { cache: "no-store" });
const bareBody = await bare.json().catch(() => ({}));
check(
  "bare fetch (the old WalletLock call) is rejected",
  bare.status === 401,
  `-> ${bare.status} ${JSON.stringify(bareBody.error || "")}`,
);

/* ── 2. What it must send ───────────────────────────────────────────────── */
const authed = await fetch(API, { cache: "no-store", headers: { Authorization: `Bearer ${tok}` } });
const authedBody = await authed.json().catch(() => ({}));
check(
  "Bearer token reaches the endpoint",
  authed.status === 200,
  `-> ${authed.status} ${JSON.stringify(authedBody)}`,
);

/* ── 3. The kv fallback must be ready, or enrolment 503s ────────────────── */
check(
  "store is ready (app_settings fallback, not a 503)",
  authed.status !== 503,
  authed.status === 503 ? "wallet_security table missing" : "",
);

/* ── 4. Enrolment itself ────────────────────────────────────────────────── */
const setPin = await fetch(API, {
  method: "POST",
  headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
  body: JSON.stringify({ action: "set_pin", pin: "2468" }),
});
const setPinBody = await setPin.json().catch(() => ({}));
check(
  "set_pin is accepted (a PIN can actually be created)",
  setPin.status === 200 && setPinBody.ok === true,
  `-> ${setPin.status} ${JSON.stringify(setPinBody).slice(0, 140)}`,
);
check(
  "set_pin returns a spend grant",
  typeof setPinBody.grant === "string" && setPinBody.grant.length > 10,
);

/* ── 5. And the PIN it just wrote must actually verify ──────────────────── */
if (setPin.status === 200) {
  const grant = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "grant_pin", pin: "2468" }),
  }).then((r) => r.json());
  check("the new PIN unlocks (hash/salt round-trip works)", grant.ok === true, JSON.stringify(grant).slice(0, 120));

  const wrong = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "grant_pin", pin: "9999" }),
  });
  check("a wrong PIN is refused", wrong.status === 400, `-> ${wrong.status}`);

  const status = await fetch(API, { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.json());
  check("status now reports hasPin", status.hasPin === true, JSON.stringify(status));

  /* Leave the account as we found it — no PIN enrolled. */
  const SB = process.env.SB_SERVICE_KEY;
  if (SB) {
    const url = `${SB_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent("wallet_security:" + auth.user.id)}`;
    const del = await fetch(url, { method: "DELETE", headers: { apikey: SB, Authorization: `Bearer ${SB}` } });
    check("cleaned up test PIN row", del.ok, `-> ${del.status}`);
  } else {
    console.log("SKIP  cleanup (no SB_SERVICE_KEY set)");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
