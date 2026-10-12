/**
 * Regression suite for the "stuck at Checking your wallet…" sheet.
 *
 * The bug: `loadStatus` only called `setStatusLoaded(true)` on its failure
 * branches. The success branch never settled the loading state, so once the
 * request started answering 200 the sheet could never leave its spinner.
 *
 * These tests drive the real `resolveWalletStatus` — not a re-implementation —
 * and assert the property the bug violated: it always resolves, on every path.
 */
import { resolveWalletStatus, lockoutActive } from "../src/lib/wallet-lock-status.ts";

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ""}`);
  }
}

function res(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

const authed = async () => ({ Authorization: "Bearer t" });

/**
 * Every call is bounded. Without this the suite itself hangs when the code under
 * test hangs — which is precisely the bug being guarded against — and a wedged
 * run reports nothing instead of reporting a failure. A hang must FAIL.
 *
 * A timeout resolves to `null` (never throws) so the run always reaches its
 * summary and names the checks that hung, rather than dying on the first one.
 */
async function within(promise, label = "") {
  const out = await Promise.race([
    promise.then((v) => ({ v })).catch((e) => ({ e })),
    new Promise((r) => setTimeout(() => r({ hung: true }), 2000)),
  ]);
  if (out.hung) {
    hung.push(label);
    return null;
  }
  if ("e" in out) {
    threw.push(`${label}: ${out.e?.message ?? out.e}`);
    return null;
  }
  return out.v;
}

/** Labels of calls that never settled — the regression's own signature. */
const hung = [];
/** Labels that rejected rather than resolving. */
const threw = [];

console.log("== settles on every path (the regression itself) ==");

// The exact case that hung: a healthy 200. Must resolve, not hang or reject.
{
  const r = await within(
    resolveWalletStatus({
      authHeaders: authed,
      request: async () => res(200, { hasPin: false, hasBiometric: false, locked: false }),
    }),
    "200",
  );
  check("200 resolves without hanging", !!r, `ok=${r?.ok}`);
  check("200 carries hasPin=false", r?.ok === true && r?.hasPin === false);
  check("200 is not an error state", r?.ok === true);
}

console.log("\n== failure paths still settle ==");
{
  const r = await within(
    resolveWalletStatus({ authHeaders: authed, request: async () => res(401, { error: "Sign in to continue" }) }),
    "401",
  );
  check("401 reports the server message", !r.ok && r.error === "Sign in to continue", r.error);
}
{
  const r = await within(
    resolveWalletStatus({
      authHeaders: authed,
      request: async () => res(503, { error: "Wallet security is not available yet" }),
    }),
    "503",
  );
  check("503 surfaces unavailability", !r.ok && /not available/.test(r.error), r.error);
}
{
  const r = await within(
    resolveWalletStatus({
      authHeaders: async () => {
        throw new Error("offline");
      },
      request: async () => res(200, {}),
    }),
    "authHeaders throws",
  );
  check("authHeaders throwing settles as offline", !r.ok && /Could not reach/.test(r.error), r.error);
}
{
  const r = await within(
    resolveWalletStatus({
      authHeaders: authed,
      request: async () => {
        throw new Error("network down");
      },
    }),
    "request throws",
  );
  check("request throwing settles as offline", !r.ok && /Could not reach/.test(r.error), r.error);
}
{
  const r = await within(
    resolveWalletStatus({ authHeaders: authed, request: async () => res(200, new Error("bad json")) }),
    "bad json",
  );
  check("malformed JSON body settles", !r.ok, r.error);
}

console.log("\n== a 200 with no usable shape is not 'not enrolled' ==");
{
  const r = await within(resolveWalletStatus({ authHeaders: authed, request: async () => res(200, {}) }), "empty 200");
  check("empty 200 is an error, not hasPin:false", !r.ok, r.error);
}

console.log("\n== lockout reporting ==");
{
  const r = await within(
    resolveWalletStatus({
      authHeaders: authed,
      request: async () =>
        res(200, { hasPin: true, hasBiometric: false, locked: true, lockedUntil: new Date(Date.now() + 60000).toISOString() }),
    }),
    "active lock",
  );
  check("active lockout is carried through", r.ok && typeof r.lockedUntil === "string", String(r.lockedUntil));
}
{
  const r = await within(
    resolveWalletStatus({
      authHeaders: authed,
      request: async () =>
        res(200, { hasPin: true, hasBiometric: false, locked: true, lockedUntil: new Date(Date.now() - 60000).toISOString() }),
    }),
    "expired lock",
  );
  check("expired lockout is still carried (lockoutActive filters it)", r.ok && typeof r.lockedUntil === "string");
}
check("lockoutActive true for the future", lockoutActive(new Date(Date.now() + 60_000).toISOString()) === true);
check("lockoutActive false for the past", lockoutActive(new Date(Date.now() - 60_000).toISOString()) === false);
check("lockoutActive false for null", lockoutActive(null) === false);
check("lockoutActive false for junk", lockoutActive("not-a-date") === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (hung.length) console.log(`NEVER SETTLED (this is the bug): ${hung.join(", ")}`);
if (threw.length) console.log(`REJECTED: ${threw.join(", ")}`);
if (fail || hung.length || threw.length) {
  console.log("failed:", failures.join(", "));
  process.exit(1);
}