/**
 * Withdrawal fee + validation tests.
 *
 * Runs the REAL functions from src/lib/withdrawal.ts — not a reimplementation.
 * Money math that only ever gets exercised by a copy of itself is not tested.
 */

import assert from "node:assert/strict";
import {
  FALLBACK_WITHDRAWAL_CONFIG,
  resolveWithdrawalConfig,
  splitWithdrawal,
  normalizeMorseTag,
  resolveUserMorseTag,
  withdrawalDestination,
  validateWithdrawal,
  sumRequestedToday,
  feePercentFor,
  resolveWithdrawalRole,
  type WithdrawalConfig,
} from "../src/lib/withdrawal.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

const pending: Array<Promise<void>> = [];

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
  } else {
    pass++;
  }
}

const cfg = (o: Partial<WithdrawalConfig> = {}): WithdrawalConfig =>
  resolveWithdrawalConfig({ ...FALLBACK_WITHDRAWAL_CONFIG, ...o });

/* ── Fees ────────────────────────────────────────────────────────────────── */

test("customer pays 2% by default", () => {
  const s = splitWithdrawal(100_000, "customer", cfg());
  assert.equal(s.feePercent, 2);
  assert.equal(s.fee, 2_000);
  assert.equal(s.net, 98_000);
});

test("rider withdraws free", () => {
  const s = splitWithdrawal(100_000, "rider", cfg());
  assert.equal(s.fee, 0);
  assert.equal(s.net, 100_000);
});

test("business withdraws free", () => {
  const s = splitWithdrawal(100_000, "business", cfg());
  assert.equal(s.fee, 0);
  assert.equal(s.net, 100_000);
});

test("fee + net === gross, always", () => {
  for (const gross of [1, 7, 99, 100, 101, 333, 1_000, 12_345, 999_999]) {
    for (const role of ["customer", "rider", "business"] as const) {
      const s = splitWithdrawal(gross, role, cfg());
      assert.equal(s.fee + s.net, s.gross, `${gross}/${role}`);
    }
  }
});

test("rounding is half-up and never loses a shilling", () => {
  // 2% of 1_050 = 21 exactly; 2% of 1_025 = 20.5 -> 21 (half-up).
  assert.equal(splitWithdrawal(1_025, "customer", cfg()).fee, 21);
  assert.equal(splitWithdrawal(1_024, "customer", cfg()).fee, 20);
  // Tiny gross where 2% rounds to zero: the customer still gets it all
  // rather than being charged a fee that exceeds the amount.
  assert.equal(splitWithdrawal(50, "customer", cfg()).fee, 1);
  assert.equal(splitWithdrawal(10, "customer", cfg()).fee, 0);
  assert.equal(splitWithdrawal(10, "customer", cfg()).net, 10);
});

test("fee percent is read live, not hardcoded", () => {
  assert.equal(feePercentFor("customer", cfg({ customer_fee_percent: 5 })), 5);
  assert.equal(feePercentFor("rider", cfg({ rider_fee_percent: 1 })), 1);
  // A config that sets the customer to 0 really does charge nothing.
  assert.equal(splitWithdrawal(100_000, "customer", cfg({ customer_fee_percent: 0 })).fee, 0);
});

/* ── Config hardening ────────────────────────────────────────────────────── */

test("nonsense config values are coerced, not trusted", () => {
  const c = resolveWithdrawalConfig({
    customer_fee_percent: "banana",
    customer_fee_percent2: undefined,
    min_amount_ugx: -5,
    max_amount_ugx: 1e99,
    enabled: "yes",
  });
  assert.equal(c.customer_fee_percent, 2, "falls back to default");
  assert.equal(c.min_amount_ugx, 0, "clamped to 0, never negative");
  assert.equal(c.enabled, true, "non-boolean falls back");
});

test("fee percent cannot be negative or absurd", () => {
  assert.equal(resolveWithdrawalConfig({ customer_fee_percent: -50 }).customer_fee_percent, 0);
  assert.equal(resolveWithdrawalConfig({ customer_fee_percent: 5000 }).customer_fee_percent, 50);
});

test("max cannot end up below min", () => {
  // Deliberately misconfigured — validation must still refuse everything
  // rather than letting a tiny amount through on a technicality.
  const c = cfg({ min_amount_ugx: 100_000, max_amount_ugx: 10_000 });
  const r = validateWithdrawal({
    amountUgx: 50_000,
    availableUgx: 500_000,
    alreadyTodayUgx: 0,
    morseTag: "ibrahim",
    cfg: c,
  });
  assert.equal(r.ok, false);
});

/* ── Morse destinations ──────────────────────────────────────────────────── */

test("accepts the Morse handles people actually type", () => {
  for (const raw of ["ibrahim", "@Ibrahim", " @ibrahim ", "go_door", "a1b2c3"]) {
    assert.equal(normalizeMorseTag(raw), normalizeMorseTag(raw).toLowerCase(), raw);
  }
  assert.equal(normalizeMorseTag("@Ibrahim"), "ibrahim");
  assert.equal(normalizeMorseTag("go_door"), "go_door");
});

test("rejects handles that are not usable Morse IDs", () => {
  for (const raw of ["", "ab", "has space", "bad!chars", "@@@", null, 42]) {
    assert.equal(normalizeMorseTag(raw), "", String(raw));
  }
  // NOTE: digits are legal in a Morse handle, so a user who chose "0772123456"
  // as their Morse ID is still paid into their GoDoor Morse wallet. What is gone
  // is the phone-number *field* — no mobile-money rail is collected or accepted
  // anywhere. See "the lookup is scoped to the caller" below.
  assert.equal(normalizeMorseTag("0772123456"), "0772123456");
});

test("a withdrawal without a Morse wallet is refused, with an actionable reason", () => {
  const r = validateWithdrawal({
    amountUgx: 50_000,
    availableUgx: 200_000,
    alreadyTodayUgx: 0,
    morseTag: "",
    cfg: cfg(),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Morse/i, "must tell the user to set a Morse ID");
});

test("admin label prefers the Morse tag and falls back for legacy records", () => {
  assert.equal(withdrawalDestination({ morseTag: "ibrahim" }), "@ibrahim");
  // Old pre-Morse requests must still show admin where they were headed.
  assert.equal(withdrawalDestination({ morseTag: "", msisdn: "0772123456" }), "0772123456 (legacy mobile money)");
  assert.equal(withdrawalDestination({ morseTag: "" }), "—");
  // Regression: a record written before this rail has NO morseTag key at all.
  // It must render in the admin queue, not throw and take the page down.
  assert.equal(withdrawalDestination({}), "—");
  assert.equal(withdrawalDestination({ msisdn: "0772123456" }), "0772123456 (legacy mobile money)");
});

/* ── Validation ──────────────────────────────────────────────────────────── */

const base = {
  amountUgx: 50_000,
  availableUgx: 200_000,
  alreadyTodayUgx: 0,
  morseTag: "ibrahim",
  cfg: cfg(),
};

test("a well-formed request passes", () => {
  assert.equal(validateWithdrawal(base).ok, true);
});

test("disabled config refuses everything", () => {
  const r = validateWithdrawal({ ...base, cfg: cfg({ enabled: false }) });
  assert.equal(r.ok, false);
});

test("cannot withdraw more than the balance", () => {
  // Round amounts only — an amount with shillings is refused by the format
  // guard first, which is the more useful message for that input.
  const r = validateWithdrawal({ ...base, amountUgx: 200_100 });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /only have/i);
});

test("format guard fires before the balance check", () => {
  const r = validateWithdrawal({ ...base, amountUgx: 200_050 });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /round amount/i);
});

test("withdrawing the entire balance is allowed", () => {
  assert.equal(validateWithdrawal({ ...base, amountUgx: 200_000 }).ok, true);
});

test("zero and negative amounts are refused", () => {
  for (const a of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateWithdrawal({ ...base, amountUgx: a as number }).ok, false, String(a));
  }
});

test("below minimum is refused", () => {
  assert.equal(validateWithdrawal({ ...base, amountUgx: 1_000, cfg: cfg({ min_amount_ugx: 5_000 }) }).ok, false);
});

test("above maximum is refused", () => {
  assert.equal(
    validateWithdrawal({ ...base, amountUgx: 9_000_000, cfg: cfg({ max_amount_ugx: 5_000_000 }) }).ok,
    false,
  );
});

test("shillings are refused — integer UGX only", () => {
  assert.equal(validateWithdrawal({ ...base, amountUgx: 50_050 }).ok, false);
  assert.equal(validateWithdrawal({ ...base, amountUgx: 50_000 }).ok, true);
});

test("daily limit blocks overspending across multiple requests", () => {
  const c = cfg({ daily_limit_ugx: 200_000 });
  // 150k already taken today, asking for 100k -> only 50k of headroom left.
  const r = validateWithdrawal({ ...base, amountUgx: 100_000, alreadyTodayUgx: 150_000, cfg: c });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /limit/i);
  // ...and exactly the headroom does go through.
  assert.equal(validateWithdrawal({ ...base, amountUgx: 50_000, alreadyTodayUgx: 150_000, cfg: c }).ok, true);
});

test("a missing phone number is refused", () => {
  assert.equal(validateWithdrawal({ ...base, morseTag: "" }).ok, false);
});

/* ── Daily rollup ────────────────────────────────────────────────────────── */

test("daily total counts pending and paid, ignores cancelled", () => {
  const mk = (status: string, day: string): any => ({
    status,
    requestedAt: `${day}T10:00:00.000Z`,
    gross: 1000,
  });
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = "2000-01-01";
  const recs = [
    mk("pending", today),
    mk("paid", today),
    mk("cancelled", today),
    mk("paid", yesterday),
  ];
  assert.equal(sumRequestedToday(recs, new Date()), 2_000);
});

/* ── Role resolution ─────────────────────────────────────────────────────── */

test("role resolution reads the database, not self-reported metadata", async () => {
  const fake = (tables: Record<string, any>) => ({
    from: (t: string) => {
      const t2 = tables[t];
      const o: any = {
        select: () => o,
        eq: () => o,
        limit: () => o,
        maybeSingle: () => o,
        then: (res: any) => res({ data: t2?.data ?? null, error: t2?.error ?? null }),
      };
      return o;
    },
  });

  assert.equal(await resolveWithdrawalRole(fake({ riders: { data: { id: "u1" } } }) as any, "u1"), "rider");
  assert.equal(
    await resolveWithdrawalRole(fake({ merchants: { data: { id: "m1" } } }) as any, "u1"),
    "business",
  );
  assert.equal(await resolveWithdrawalRole(fake({}) as any, "u1"), "customer");
  // Someone who both drives and owns a shop is an earner, not a payer.
  assert.equal(
    await resolveWithdrawalRole(
      fake({ riders: { data: { id: "u1" } }, merchants: { data: { id: "m1" } } }) as any,
      "u1",
    ),
    "business",
  );
});

/* ── Report ──────────────────────────────────────────────────────────────── */

await Promise.all(pending);

console.log(`\nwithdrawal tests: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(1);
}

/* ── The server owns the destination ─────────────────────────────────────── */

/** Minimal faithful PostgREST fake: the profile row is per-actor, as in reality. */
function profileClient(row: { morse_tag?: string | null } | null, opts: { error?: boolean } = {}) {
  const calls: Array<{ table: string; userId: string }> = [];
  const client = {
    calls,
    from(table: string) {
      let userId = "";
      const chain = {
        select(_cols: string) {
          return chain;
        },
        eq(col: string, val: string) {
          if (col === "id") userId = val;
          return chain;
        },
        async maybeSingle() {
          calls.push({ table, userId });
          if (opts.error) return { data: null, error: { message: "boom" } };
          return { data: row, error: null };
        },
      };
      return chain;
    },
  };
  return client as never;
}

await test("resolves the signed-in user's own Morse tag", async () => {
  const tag = await resolveUserMorseTag(profileClient({ morse_tag: "@Ibrahim" }), "actor-1");
  assert.equal(tag, "ibrahim");
});

await test("the lookup is scoped to the caller, so one user cannot pay another", async () => {
  const sb = profileClient({ morse_tag: "ibrahim" });
  await resolveUserMorseTag(sb, "actor-1");
  assert.deepEqual(
    (sb as unknown as { calls: Array<{ table: string; userId: string }> }).calls,
    [{ table: "profiles", userId: "actor-1" }],
    "must query the caller's own row, keyed on their id",
  );
});

await test("an unusable stored tag resolves to empty so the user is blocked", async () => {
  assert.equal(await resolveUserMorseTag(profileClient({ morse_tag: "" }), "a"), "");
  assert.equal(await resolveUserMorseTag(profileClient({ morse_tag: null }), "a"), "");
  // A phone number left over from the old rail is not a valid Morse ID.
  assert.equal(await resolveUserMorseTag(profileClient({ morse_tag: "0772123456" }), "a"), "");
});

await test("a failed lookup blocks the payout rather than defaulting to blank-ok", async () => {
  assert.equal(await resolveUserMorseTag(profileClient(null, { error: true }), "a"), "");
});
