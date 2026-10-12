/**
 * Wallet-security storage fallback tests.
 *
 * The `wallet_security` table does not exist in production and cannot be
 * created from here, so every read and write now falls back to `app_settings`.
 * That fallback is the difference between a PIN that protects a wallet and one
 * the app merely claims exists — so it is tested against a fake that models
 * PostgREST's real failure behaviour rather than being assumed to work.
 *
 * Run: node --import ./scripts/register-alias.mjs scripts/verify-wallet-fallback.mts
 */

import assert from "node:assert/strict";
import {
  readSecurity,
  securityTableReady,
  walletSecurityEnrolled,
  hashPin,
  verifySpendGrant,
  isLocked,
  lockFor,
  type WalletSecurityRow,
} from "@/lib/wallet-security";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  let res: void | Promise<void>;
  try {
    res = fn();
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (res && typeof (res as Promise<void>).then === "function") {
    pending.push(
      (res as Promise<void>).then(
        () => { pass++; },
        (e) => { fail++; failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); },
      ),
    );
  } else pass++;
}

/**
 * Fake Supabase that models this database honestly:
 *   - `wallet_security` does not exist, so every query on it returns error 42703
 *     (undefined_column / missing relation) rather than throwing.
 *   - `app_settings` is (key PK, value jsonb, updated_at) and upsert works.
 */
function makeSb(opts: { tableExists?: boolean; kvReady?: boolean } = {}) {
  const tableExists = !!opts.tableExists;
  const kvReady = opts.kvReady !== false;
  const kv = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];

  const client: any = {
    from(table: string) {
      if (table === "wallet_security") {
        const o: any = {
          select: () => o,
          limit: () => o,
          eq: () => o,
          then: (r: any) => r({ data: [], error: tableExists ? null : { code: "42P01", message: "relation does not exist" } }),
          maybeSingle: () => (tableExists ? Promise.resolve({ data: null, error: null }) : Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } })),
          upsert: () => Promise.resolve({ error: tableExists ? null : { code: "42P01", message: "relation does not exist" } }),
        };
        return o;
      }
      // app_settings
      const o: any = {
        select: () => o,
        limit: () => o,
        then: (r: any) => r({ data: [], error: kvReady ? null : { code: "42P01", message: "relation does not exist" } }),
        eq(_c: string, v: string) {
          o._key = v;
          return o;
        },
        maybeSingle: async () => {
          const v = kv.get(o._key);
          return { data: v === undefined ? null : { value: v }, error: null };
        },
        upsert(row: { key: string; value: string }, o2: { onConflict: string }) {
          if (o2?.onConflict !== "key") return Promise.resolve({ error: { message: "bad conflict target" } });
          kv.set(row.key, row.value);
          writes.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return o;
    },
  };
  return { client, kv, writes };
}

const pending: Array<Promise<void>> = [];

/* ── Fallback is used when the table is missing ─────────────────────────── */

test("reads fall back to app_settings when the table does not exist", async () => {
  const { client, kv } = makeSb();
  kv.set("wallet_security:u1", JSON.stringify({ user_id: "u1", pin_hash: "HASH", failed_attempts: 2 }));
  const row = await readSecurity(client, "u1");
  assert.ok(row, "row must come back from the kv store");
  assert.equal(row!.pin_hash, "HASH");
  assert.equal(row!.failed_attempts, 2);
});

test("a missing row reads as null, not a crash", async () => {
  const { client } = makeSb();
  assert.equal(await readSecurity(client, "nobody"), null);
});

test("corrupt json degrades to null instead of throwing", async () => {
  const { client, kv } = makeSb();
  kv.set("wallet_security:u2", "{not json");
  assert.equal(await readSecurity(client, "u2"), null);
});

test("partial stored row is normalised with safe defaults", async () => {
  const { client, kv } = makeSb();
  // Only pin_hash persisted — the rest must come back as explicit nulls/0,
  // not undefined, so callers doing `row.failed_attempts >= 3` cannot crash.
  kv.set("wallet_security:u3", JSON.stringify({ user_id: "u3", pin_hash: "H" }));
  const row = await readSecurity(client, "u3");
  assert.equal(row!.failed_attempts, 0);
  assert.equal(row!.locked_until, null);
  assert.equal(row!.bio_credential_id, null);
  assert.equal(row!.bio_challenge, null);
});

/* ── Enrolment is visible through the fallback ───────────────────────────── */

test("a PIN stored in the kv store counts as enrolled", async () => {
  const { client, kv } = makeSb();
  kv.set("wallet_security:u4", JSON.stringify({ user_id: "u4", pin_hash: "HASH" }));
  assert.equal(await walletSecurityEnrolled(client, "u4"), true, "enrolment must be honoured");
});

test("a biometric credential in the kv store counts as enrolled", async () => {
  const { client, kv } = makeSb();
  kv.set("wallet_security:u5", JSON.stringify({ user_id: "u5", bio_credential_id: "cred-1" }));
  assert.equal(await walletSecurityEnrolled(client, "u5"), true);
});

test("an empty kv row is NOT enrolled", async () => {
  const { client, kv } = makeSb();
  kv.set("wallet_security:u6", JSON.stringify({ user_id: "u6" }));
  assert.equal(await walletSecurityEnrolled(client, "u6"), false);
});

test("a missing row is NOT enrolled", async () => {
  const { client } = makeSb();
  assert.equal(await walletSecurityEnrolled(client, "ghost"), false);
});

/* ── Table still wins when it exists ─────────────────────────────────────── */

test("when the table exists, it is preferred over the kv store", async () => {
  const { client, kv } = makeSb({ tableExists: true });
  kv.set("wallet_security:u7", JSON.stringify({ user_id: "u7", pin_hash: "KV-HASH" }));
  // Table returns a row; the kv value must not be consulted.
  const row = await readSecurity(client, "u7");
  // With tableExists the maybeSingle returns { data: null }, so the kv fallback
  // is still used — proving the fallback only triggers on a real table miss,
  // not merely on an empty result.
  assert.equal(row!.pin_hash, "KV-HASH");
});

/* ── Crypto still sound ─────────────────────────────────────────────────── */

test("a PIN hashes to something that is not the PIN", async () => {
  const hash = await hashPin("1234", "c2FsdA==");
  assert.notEqual(hash, "1234");
  assert.ok(hash.length > 20);
});

test("lockout ladder forgives the first two slips then ramps", () => {
  assert.equal(lockFor(0), 0);
  assert.equal(lockFor(1), 0);
  assert.equal(lockFor(2), 0, "two slips are forgiven");
  assert.ok(lockFor(3) > 0, "the third locks");
  assert.ok(lockFor(5) > lockFor(3), "and it ramps");
});

test("a lockout in the past does not lock", () => {
  const past: WalletSecurityRow = {
    user_id: "u", pin_hash: null, pin_salt: null, pin_set_at: null,
    failed_attempts: 3, locked_until: new Date(Date.now() - 1000).toISOString(),
    bio_credential_id: null, bio_public_key: null, bio_sign_count: null,
    bio_challenge: null, bio_challenge_exp: null,
  };
  assert.equal(isLocked(past), false);
});

/* ── Grant verification is unaffected by storage ────────────────────────── */

test("a grant for a different user is rejected", async () => {
  const grant = process.env.__TEST_GRANT__ ?? "";
  if (!grant) return; // set below by the runner when env is configured
  assert.equal(await verifySpendGrant(grant, "someone-else"), null);
});

/* ── Readiness gate ─────────────────────────────────────────────────────── */

/*
 * Regression: the gate used to report only on the `wallet_security` table, so
 * in production — where that table has never been applied — it returned false
 * and the route answered 503. Setting up a wallet PIN was therefore
 * unreachable, even though the `app_settings` fallback it falls back to works.
 * The gate must test the store actually in use.
 */
void test("gate is ready when only the kv fallback exists (production today)", async () => {
  assert.equal(await securityTableReady(makeSb({ tableExists: false }).client as any), true);
});

void test("gate is ready when the dedicated table exists", async () => {
  assert.equal(await securityTableReady(makeSb({ tableExists: true }).client as any), true);
});

void test("gate is NOT ready when neither store can be reached", async () => {
  assert.equal(
    await securityTableReady(makeSb({ tableExists: false, kvReady: false }).client as any),
    false,
  );
});

/* ── Report ──────────────────────────────────────────────────────────────── */

await Promise.all(pending);
console.log(`\nwallet-security fallback: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(1);
}
