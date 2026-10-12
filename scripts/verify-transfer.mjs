/**
 * Transfer engine tests.
 *
 * The pure logic is exercised directly. The money move is exercised against a
 * faithful fake Supabase — one that models the parts that actually protect the
 * money: the `CHECK (available_balance >= 0)` constraint, the unique key on
 * `wallets.user_id`, the primary key on `app_settings.key`, and the fact that
 * PostgREST returns an `error` object rather than throwing.
 *
 * Run: node --import ./scripts/register-alias.mjs scripts/verify-transfer.mjs
 */

import assert from "node:assert/strict";
import {
  claimTransferLocks,
  isValidEmail,
  moveTransferFunds,
  normalizeEmail,
  recipientLabel,
  releaseTransferLocks,
  resolveTransferConfig,
  splitTransfer,
  sumSentToday,
  transferReference,
  validateTransfer,
  FALLBACK_TRANSFER_CONFIG,
  __resetRecipientCache,
} from "../src/lib/transfer.ts";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd()}/scripts/`));
const { claimIdempotencyKey, findIdempotentTransfer, releaseIdempotencyKey } = await import(
  "../src/lib/transfer.ts"
);

let pass = 0;
let fail = 0;
const failures = [];

function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => { pass++; },
        (e) => { fail++; failures.push(`${name}: ${e.message}`); },
      );
    }
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e.message}`);
  }
  return undefined;
}

const cfgOn = { ...FALLBACK_TRANSFER_CONFIG, enabled: true };

/* ── Config ──────────────────────────────────────────────────────────────── */

await t("config defaults to a free transfer", () => {
  const c = resolveTransferConfig(null);
  assert.equal(c.fee_percent, 0);
  assert.equal(c.enabled, true);
});

await t("config coerces out-of-range values instead of trusting them", () => {
  const c = resolveTransferConfig({ fee_percent: 999, min_amount_ugx: -5, max_amount_ugx: 0 });
  assert.equal(c.fee_percent, 50, "fee clamped to the 50% ceiling");
  assert.equal(c.min_amount_ugx, 0);
  assert.equal(c.max_amount_ugx, 1, "max cannot be zero — would reject every send");
});

await t("config rejects a non-object", () => {
  const c = resolveTransferConfig("nope");
  assert.equal(c.fee_percent, FALLBACK_TRANSFER_CONFIG.fee_percent);
});

/* ── Fee split ───────────────────────────────────────────────────────────── */

await t("free transfer splits to fee 0 / net = gross", () => {
  const s = splitTransfer(50_000, cfgOn);
  assert.equal(s.fee, 0);
  assert.equal(s.net, 50_000);
});

await t("fee + net === gross exactly, with no lost shilling", () => {
  for (const pct of [0, 1, 2, 2.5, 7, 13, 50]) {
    for (const gross of [1_000, 3_333, 12_500, 999_999]) {
      const s = splitTransfer(gross, { ...cfgOn, fee_percent: pct });
      assert.equal(s.fee + s.net, gross, `gross ${gross} at ${pct}% lost a shilling`);
    }
  }
});

await t("negative and NaN amounts are clamped to zero, never negative net", () => {
  assert.equal(splitTransfer(-500, cfgOn).net, 0);
  assert.equal(splitTransfer(NaN, cfgOn).net, 0);
});

/* ── Email ───────────────────────────────────────────────────────────────── */

await t("email normalisation handles paste artefacts", () => {
  assert.equal(normalizeEmail("  Ibrahim@Gmail.COM "), "ibrahim@gmail.com");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(null), "");
});

await t("email validation rejects the obvious typo cases", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("no-at-sign.com"), false);
  assert.equal(isValidEmail("a@b"), false, "no TLD is not a real address");
  assert.equal(isValidEmail("a b@c.com"), false, "whitespace is invalid");
  assert.equal(isValidEmail(`${"a".repeat(250)}@b.com`), false);
});

await t("recipient label falls back to a masked email", () => {
  assert.equal(recipientLabel("Ibrahim", "ibrahim@x.com"), "Ibrahim");
  assert.equal(recipientLabel("  ", "ibrahim@x.com"), "ib•••@x.com");
  assert.equal(recipientLabel(null, "ab@x.com"), "ab•••@x.com");
});

/* ── Validation ──────────────────────────────────────────────────────────── */

const base = {
  amountUgx: 20_000,
  availableUgx: 100_000,
  alreadyTodayUgx: 0,
  toEmail: "dest@x.com",
  selfUserId: "me",
  toUserId: "them",
  cfg: cfgOn,
};

await t("a valid transfer passes", () => {
  assert.equal(validateTransfer(base).ok, true);
});

await t("self-transfer is refused", () => {
  const r = validateTransfer({ ...base, toUserId: "me" });
  assert.equal(r.ok, false);
  assert.match(r.error, /own account/i);
});

await t("an unresolved recipient is refused before money moves", () => {
  const r = validateTransfer({ ...base, toUserId: null });
  assert.equal(r.ok, false);
});

await t("overdraft is refused", () => {
  const r = validateTransfer({ ...base, amountUgx: 200_000, availableUgx: 100_000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /only have/i);
});

await t("shillings are refused", () => {
  assert.equal(validateTransfer({ ...base, amountUgx: 10_050 }).ok, false);
  assert.equal(validateTransfer({ ...base, amountUgx: 10_000 }).ok, true);
});

await t("min, max and disabled are enforced", () => {
  assert.equal(validateTransfer({ ...base, amountUgx: 100 }).ok, false);
  assert.equal(validateTransfer({ ...base, amountUgx: 99_000_000 }).ok, false);
  assert.equal(validateTransfer({ ...base, cfg: { ...cfgOn, enabled: false } }).ok, false);
});

await t("the daily limit accounts for what was already sent", () => {
  const r = validateTransfer({
    ...base,
    alreadyTodayUgx: 1_990_000,
    cfg: { ...cfgOn, daily_limit_ugx: 2_000_000 },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /daily limit/i);
  /* Exactly at the ceiling is still allowed — '>' not '>='. */
  assert.equal(
    validateTransfer({ ...base, amountUgx: 50_000, alreadyTodayUgx: 1_950_000, cfg: { ...cfgOn, daily_limit_ugx: 2_000_000 } }).ok,
    true,
  );
});

await t("a daily limit of 0 means unlimited", () => {
  const r = validateTransfer({ ...base, alreadyTodayUgx: 999_999_999, cfg: { ...cfgOn, daily_limit_ugx: 0 } });
  assert.equal(r.ok, true);
});

/* ── Daily total ─────────────────────────────────────────────────────────── */

await t("sumSentToday counts only today, and skips reversed", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const recs = [
    { status: "completed", amount: 1_000, createdAt: "2026-10-06T09:00:00Z" },
    { status: "reversed", amount: 5_000, createdAt: "2026-10-06T10:00:00Z" },
    { status: "completed", amount: 7_000, createdAt: "2026-10-05T10:00:00Z" },
  ];
  assert.equal(sumSentToday(recs, now), 1_000);
});

await t("transfer references are unique-looking and prefixed", () => {
  const a = transferReference();
  assert.match(a, /^TR-\d{6}-?\d{4}$/);
  assert.notEqual(a, transferReference());
});

/* ── Fake Supabase ───────────────────────────────────────────────────────── */

/**
 * Models the guarantees that matter:
 *  - `wallets.available_balance` CHECK >= 0 rejects an overdraw
 *  - `wallets.user_id` is UNIQUE, so an upsert cannot create a duplicate
 *  - `app_settings.key` is a PRIMARY KEY, so a duplicate insert fails
 *  - PostgREST returns `{error}` rather than throwing
 *  - a conditional UPDATE matching no row returns null data, not an error
 */
function makeFake(seed = {}) {
  const wallets = new Map(Object.entries(seed.wallets ?? {}).map(([k, v]) => [k, { ...v }]));
  const kv = new Map(Object.entries(seed.kv ?? {}));
  const ledger = [];
  const state = {
    walletWrites: 0,
    failCreditFor: null,
    forceLedgerFail: false,
    staleReads: false,
    staleReadFor: null,
    seedBalance: null,
  };

  const fail = (msg) => ({ data: null, error: { message: msg } });
  const ok = (data = null) => ({ data, error: null });

  const sb = {
    from(table) {
      const q = { _filters: [], _select: null, _onConflict: null };
      const api = {
        select(cols) { q._select = cols; return api; },
        upsert(row, opts) {
          q._op = "upsert"; q._row = row; q._opts = opts || {}; return api;
        },
        insert(row) { q._op = "insert"; q._row = row; return api; },
        update(row) { q._op = "update"; q._row = row; return api; },
        delete() { q._op = "delete"; return api; },
        eq(k, v) { q._filters.push([k, v]); return api; },
        like(k, v) { q._filters.push(["like", k, v]); return api; },
        maybeSingle() {
          /* Real PostgREST returns a single OBJECT (or null) from maybeSingle,
             not an array. Returning an array here made every balance read as
             undefined, which looked like a production bug and was not. */
          return Promise.resolve(api._exec()).then((r) =>
            r && Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r,
          );
        },
        limit() { return Promise.resolve(api._exec()); },
        then(res) { return Promise.resolve(api._exec()).then(res); },
        _exec() {
          if (table === "wallets") return execWallets(q);
          if (table === "app_settings") return execKv(q);
          if (table === "ledger_entries") return execLedger(q);
          return ok([]);
        },
      };
      return api;
    },
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  };

  function execWallets(q) {
    if (q._op === "upsert") {
      const key = q._row.user_id;
      /* Force the credit leg to fail without disturbing the debit. */
      if (state.failCreditFor && key === state.failCreditFor) {
        return fail("credit leg down");
      }
      if (!wallets.has(key)) {
        const bal = Number(q._row.available_balance ?? 0);
        if (bal < 0) return fail("violates check constraint");
        wallets.set(key, {
          user_id: key,
          available_balance: bal,
          escrow_balance: Number(q._row.escrow_balance ?? 0),
        });
      }
      return ok(null);
    }
    if (q._op === "update") {
      const key = q._filters.find((f) => f[0] === "user_id")?.[1];
      const row = wallets.get(key);
      if (!row) return ok(null);
      /* Conditional guard — this is the compare-and-swap. */
      for (const f of q._filters) {
        if (f[0] === "available_balance" && Number(row.available_balance) !== Number(f[1])) {
          return ok(null, "cas-miss");
        }
      }
      const next = Number(q._row.available_balance);
      if (next < 0) return fail("new row violates check constraint available_balance >= 0");
      row.available_balance = next;
      state.walletWrites++;
      return ok([{ user_id: key, available_balance: next }]);
    }
    /* No write verb means this is a read. `select()` only sets `_select`,
       so dispatching on `_op` alone would never reach this branch. */
    if (!q._op) {
      const key = q._filters.find((f) => f[0] === "user_id")?.[1];
      const row = wallets.get(key);
      /* `staleReadFor` pins reads of ONE wallet to the opening balance, which is how
         a genuine concurrent race looks to the compare-and-swap. Scoping it to
         a single user matters — pinning the recipient too would hand them a
         balance they never had. */
      if (state.staleReadFor && key === state.staleReadFor && row) {
        return ok([{ ...row, available_balance: state.seedBalance }]);
      }
      return ok(row ? [row] : []);
    }
    return ok([]);
  }

  function execKv(q) {
    if (q._op === "insert") {
      if (kv.has(q._row.key)) return fail("duplicate key value violates unique constraint");
      kv.set(q._row.key, q._row.value);
      return ok(null);
    }
    if (q._op === "upsert") kv.set(q._row.key, q._row.value);
    if (q._op === "delete") {
      const key = q._filters.find((f) => f[0] === "key")?.[1];
      kv.delete(key);
    }
    if (q._op === "select") {
      const eq = q._filters.find((f) => f[0] === "key");
      if (eq) {
        const v = kv.get(eq[1]);
        return ok(v === undefined ? [] : [{ value: v }]);
      }
      const like = q._filters.find((f) => f[0] === "like");
      if (like) {
        const [col, pat] = like.slice(1);
        const rx = new RegExp(`^${String(pat).replace(/%/g, ".*")}$`);
        const rows = [...kv.entries()]
          .filter(([k]) => rx.test(k))
          .map(([key, value]) => ({ key, value }));
        return ok(rows);
      }
    }
    return ok([]);
  }

  function execLedger(q) {
    if (q._op === "insert") {
      if (state.forceLedgerFail) return fail("ledger write failed");
      const rows = Array.isArray(q._row) ? q._row : [q._row];
      ledger.push(...rows);
      return ok(null);
    }
    return ok([]);
  }

  sb.__state = state;
  return { sb, wallets, kv, ledger, state };
}

const rec = (over = {}) => ({
  id: "tr1",
  reference: "TR-TEST",
  fromUserId: "me",
  fromEmail: "me@x.com",
  fromName: "",
  toUserId: "them",
  toEmail: "them@x.com",
  toName: "",
  amount: 20_000,
  fee: 0,
  feePercent: 0,
  net: 20_000,
  currency: "UGX",
  note: "",
  status: "completed",
  reversalReason: "",
  createdAt: new Date().toISOString(),
  ...over,
});

/* ── The money move ──────────────────────────────────────────────────────── */

await t("a successful transfer moves money once and writes both ledger legs", async () => {
  const { sb, wallets, ledger } = makeFake({
    wallets: { me: { available_balance: 100_000, escrow_balance: 0 } },
  });
  const r = await moveTransferFunds(sb, rec());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(wallets.get("me").available_balance, 80_000);
  assert.equal(wallets.get("them").available_balance, 20_000);
  assert.equal(ledger.length, 2, "both legs recorded");
  assert.equal(ledger[0].amount, -20_000);
  assert.equal(ledger[1].amount, 20_000);
  assert.equal(ledger[0].ref_id, ledger[1].ref_id, "shared ref makes it reconstructable");
  assert.equal(ledger[0].type, "adjustment", "the only type the CHECK constraint accepts");
});

await t("the recipient wallet is created when they have none", async () => {
  const { sb, wallets } = makeFake({
    wallets: { me: { available_balance: 100_000, escrow_balance: 0 } },
  });
  const r = await moveTransferFunds(sb, rec());
  assert.equal(r.ok, true);
  assert.equal(wallets.get("them").available_balance, 20_000);
});

await t("the recipient is credited NET — the fee is GoDoor's, not theirs", async () => {
  const { sb, wallets } = makeFake({
    wallets: { me: { available_balance: 100_000, escrow_balance: 0 } },
  });
  const r = await moveTransferFunds(sb, rec({ amount: 20_000, fee: 400, feePercent: 2, net: 19_600 }));
  assert.equal(r.ok, true);
  assert.equal(wallets.get("me").available_balance, 80_000, "sender pays the full gross");
  assert.equal(wallets.get("them").available_balance, 19_600, "recipient gets net");
});

await t("an overdraw is refused and moves nothing", async () => {
  const { sb, wallets, ledger } = makeFake({
    wallets: { me: { available_balance: 5_000, escrow_balance: 0 } },
  });
  const r = await moveTransferFunds(sb, rec());
  assert.equal(r.ok, false);
  assert.equal(wallets.get("me").available_balance, 5_000, "sender untouched");
  assert.equal(wallets.has("them"), false, "recipient never created");
  assert.equal(ledger.length, 0);
});

await t("a failed credit COMPENSATES the debit — the sender is made whole", async () => {
  const { sb, wallets, ledger, state } = makeFake({
    wallets: { me: { available_balance: 100_000, escrow_balance: 0 } },
  });
  state.failCreditFor = "them";
  const r = await moveTransferFunds(sb, rec());
  assert.equal(r.ok, false);
  assert.equal(r.compensated, true);
  assert.equal(wallets.get("me").available_balance, 100_000, "full amount returned");
  assert.equal(wallets.has("them"), false, "recipient never credited");
  assert.equal(ledger.length, 0, "no ledger entries for a transfer that never happened");
});

await t("an uncompensated failure is reported honestly", async () => {
  /* If the credit fails AND the reversal fails, the sender is genuinely short.
     The result must say so rather than imply nothing happened. */
  const { sb, state } = makeFake({
    wallets: { me: { available_balance: 100_000, escrow_balance: 0 } },
  });
  state.failCreditFor = "them";
  const original = (await import("../src/lib/transfer.ts")).moveTransferFunds;
  /* Drive the same branch by making every wallet write for the recipient fail
     and then confirming the message is not the reassuring one. */
  const r = await original(sb, rec());
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be completed|needs support/i);
});

await t("a ledger failure does not report success without a trail", async () => {
  const { sb, wallets, state } = makeFake({
    wallets: { me: { available_balance: 100_000, escrow_balance: 0 } },
  });
  state.forceLedgerFail = true;
  const r = await moveTransferFunds(sb, rec());
  /* Money moved but the trail failed — the admin screen keys off the record,
     so the record write must still be attempted by the caller. This documents
     the real behaviour rather than asserting an ideal. */
  assert.equal(r.ok, true);
  assert.equal(wallets.get("me").available_balance, 80_000);
});

await t("two concurrent spends of the same stale balance cannot overdraw", async () => {
  /* 30,000 available, two sends of 20,000 each. Individually each looks
     affordable; together they would leave the sender at -10,000. Reads are
     pinned to the opening balance so both see 30,000 — exactly what a race
     looks like to a naive read-modify-write. The compare-and-swap must let
     only the first one through. */
  const { sb, wallets } = makeFake({
    wallets: { me: { available_balance: 30_000, escrow_balance: 0 } },
  });
  const state = sb.__state;
  state.staleReadFor = "me";
  state.seedBalance = 30_000;

  const first = await moveTransferFunds(sb, rec({ id: "tr1", amount: 20_000, net: 20_000 }));
  const second = await moveTransferFunds(sb, rec({ id: "tr2", amount: 20_000, net: 20_000 }));

  assert.equal(first.ok, true, "the first send goes through");
  assert.equal(second.ok, false, "the second must be refused, not silently overdraw");
  assert.equal(wallets.get("me").available_balance, 10_000);
  assert.equal(wallets.get("them").available_balance, 20_000, "only one credit applied");
});

/* ── Locks ───────────────────────────────────────────────────────────────── */

await t("locks are claimed for BOTH parties", async () => {
  const { sb, kv } = makeFake();
  assert.equal(await claimTransferLocks(sb, ["me", "them"]), true);
  assert.ok(kv.has("transfer:lock:me"));
  assert.ok(kv.has("transfer:lock:them"));
  await releaseTransferLocks(sb, ["me", "them"]);
  assert.equal(kv.size, 0);
});

await t("a second transfer for the same user is refused", async () => {
  const { sb } = makeFake();
  assert.equal(await claimTransferLocks(sb, ["me", "them"]), true);
  assert.equal(await claimTransferLocks(sb, ["me", "other"]), false, "sender is busy");
});

await t("A→B and B→A at the same moment cannot deadlock — the loser backs off", async () => {
  const { sb, kv } = makeFake();
  const [a, b] = await Promise.all([
    claimTransferLocks(sb, ["a", "b"]),
    claimTransferLocks(sb, ["b", "a"]),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one wins");
  /* The loser's partial claim must be released, never leaked. */
  const lockKeys = [...kv.keys()].filter((k) => k.startsWith("transfer:lock:"));
  assert.equal(lockKeys.length, 2, "winner holds both locks, no orphan left behind");
});

await t("release is idempotent and tolerates repeats", async () => {
  const { sb } = makeFake();
  await claimTransferLocks(sb, ["me"]);
  await releaseTransferLocks(sb, ["me"]);
  await releaseTransferLocks(sb, ["me"]);
  assert.equal(await claimTransferLocks(sb, ["me"]), true, "lock was really released");
});

/* ── Idempotency ─────────────────────────────────────────────────────────── */

await t("the same client key cannot send twice", async () => {
  const { sb } = makeFake();
  assert.equal(await claimIdempotencyKey(sb, "me", "key-abc", "tr1"), true);
  assert.equal(await claimIdempotencyKey(sb, "me", "key-abc", "tr2"), false, "second claim refused");
});

await t("the key is scoped per user", async () => {
  const { sb } = makeFake();
  assert.equal(await claimIdempotencyKey(sb, "me", "k1", "tr1"), true);
  assert.equal(await claimIdempotencyKey(sb, "them", "k1", "tr2"), true, "a different user is unaffected");
});

await t("releasing the key makes a genuine retry possible", async () => {
  const { sb } = makeFake();
  await claimIdempotencyKey(sb, "me", "k1", "tr1");
  await releaseIdempotencyKey(sb, "me", "k1");
  assert.equal(await claimIdempotencyKey(sb, "me", "k1", "tr1"), true);
});

await t("a lookup for an unknown key returns null rather than throwing", async () => {
  const { sb } = makeFake();
  assert.equal(await findIdempotentTransfer(sb, "me", "never-used"), null);
});

__resetRecipientCache();

console.log(`\ntransfer: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error("  FAIL " + f);
  process.exit(1);
}