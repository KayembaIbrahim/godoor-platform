/**
 * Tests for the admin security-question recovery module.
 *
 * These run against the REAL exported functions against a faithful in-memory
 * `app_settings` fake (upsert / maybeSingle / PK conflict), because this code
 * guards a password-reset door on a portal that moves real money.
 *
 *   node --test scripts/verify-admin-recovery.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/lib/admin-recovery.ts");
const {
  setRecoveryAnswer, verifyRecoveryAnswer, getRecoveryStatus, normaliseAnswer,
  answerError, recoveryLockMs, clearRecoveryFailures, RECOVERY_QUESTION,
  RECOVERY_LOCK_THRESHOLD, ANSWER_MIN_LENGTH,
} = mod;

/** Faithful `app_settings` fake: key/value, PK on key, upsert semantics. */
function fakeDb(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const state = { rows, calls: 0, lastError: null, failNext: 0 };
  const db = {
    from(table) {
      assert.equal(table, "app_settings", "recovery must only ever touch app_settings");
      state.calls++;
      if (state.failNext > 0) {
        state.failNext--;
        state.lastError = "boom";
        const q = { eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) };
        return { select: () => q };
      }
      state.lastError = null;
      return {
        select() {
          const q = {
            eq(key, value) {
              assert.equal(key, "key");
              return {
                async maybeSingle() {
                  const row = rows.get(value);
                  return { data: row ? { key: row.key, value: row.value } : null, error: null };
                },
              };
            },
          };
          return q;
        },
        async upsert(obj) {
          if (!obj || typeof obj.key !== "string") return { error: { message: "bad row" } };
          rows.set(obj.key, { key: obj.key, value: obj.value, updated_at: obj.updated_at ?? null });
          return { error: null };
        },
      };
    },
  };
  return Object.assign(db, { state, rows, setRows: rows });
}

const storedValue = (db) => JSON.parse(db.state.rows.get("admin_recovery").value);

test("RECOVERY_QUESTION is the question the owner asked for", () => {
  assert.equal(RECOVERY_QUESTION, "What is my childhood nickname?");
});

test("the answer is never stored in plaintext — only a scrypt hash", async () => {
  const db = fakeDb();
  assert.equal(await setRecoveryAnswer(db, "kay"), true);

  const raw = db.state.rows.get("admin_recovery").value;
  assert.ok(!raw.includes("kay"), "the answer must not appear anywhere in the stored blob");
  const rec = storedValue(db);
  assert.match(rec.answer_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
});

test("the correct answer unlocks; a wrong one does not", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  assert.equal((await verifyRecoveryAnswer(db, "kay")).ok, true);

  const wrong = await verifyRecoveryAnswer(db, "kobe");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "wrong");
});

test("answers are case- and whitespace-insensitive", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "BigBoy");
  for (const variant of ["bigboy", "BIGBOY", "  bigboy  ", "BigBoy"]) {
    const v = await verifyRecoveryAnswer(db, variant);
    assert.equal(v.ok, true, `"${variant}" should match`);
  }
});

test("the question itself is not the answer", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  const v = await verifyRecoveryAnswer(db, "What is my childhood nickname?");
  assert.equal(v.ok, false);
});

test("a fresh salt per answer means identical answers hash differently", async () => {
  const a = fakeDb();
  const b = fakeDb();
  await setRecoveryAnswer(a, "kay");
  await setRecoveryAnswer(b, "kay");
  assert.notEqual(storedValue(a).answer_hash, storedValue(b).answer_hash);
});

test("5 wrong answers lock recovery; the correct answer is then refused", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");

  for (let i = 1; i < RECOVERY_LOCK_THRESHOLD; i++) {
    const v = await verifyRecoveryAnswer(db, `wrong${i}`);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "wrong", `attempt ${i} should be a plain wrong-answer`);
  }

  const trigger = await verifyRecoveryAnswer(db, "nope");
  assert.equal(trigger.ok, false);
  assert.equal(trigger.reason, "wrong");
  assert.ok(trigger.lockRemainingMs > 0, "the 5th failure must start the lock");

  // Even the CORRECT answer is refused while locked — otherwise the lock is
  // just a speed bump an attacker or the owner could ignore.
  const locked = await verifyRecoveryAnswer(db, "kay");
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "locked");
  assert.ok(locked.lockRemainingMs > 0);
});

test("the lock ladder grows and is capped at 6 hours", () => {
  assert.equal(recoveryLockMs(RECOVERY_LOCK_THRESHOLD), 60_000);
  assert.equal(recoveryLockMs(RECOVERY_LOCK_THRESHOLD + 1), 120_000);
  assert.ok(recoveryLockMs(RECOVERY_LOCK_THRESHOLD + 5) > recoveryLockMs(RECOVERY_LOCK_THRESHOLD + 4));
  assert.equal(recoveryLockMs(999), 6 * 60 * 60 * 1000);
});

test("attempts are counted down so the owner knows how many are left", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  const first = await verifyRecoveryAnswer(db, "wrong");
  assert.equal(first.attemptsRemaining, RECOVERY_LOCK_THRESHOLD - 1);
});

test("a successful answer resets the counter", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  await verifyRecoveryAnswer(db, "wrong");
  await verifyRecoveryAnswer(db, "wrong");
  assert.equal(storedValue(db).failed_attempts, 2);

  assert.equal((await verifyRecoveryAnswer(db, "kay")).ok, true);
  assert.equal(storedValue(db).failed_attempts, 0);
});

test("an expired lock lets the owner back in", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  for (let i = 0; i < RECOVERY_LOCK_THRESHOLD; i++) await verifyRecoveryAnswer(db, `wrong${i}`);
  assert.equal((await verifyRecoveryAnswer(db, "kay")).reason, "locked");

  // Wind the clock back past the lock, as time passing would.
  const rec = storedValue(db);
  rec.locked_until = new Date(Date.now() - 1000).toISOString();
  db.state.rows.set("admin_recovery", { key: "admin_recovery", value: JSON.stringify(rec), updated_at: null });

  assert.equal((await verifyRecoveryAnswer(db, "kay")).ok, true);
});

test("an empty or too-short answer is refused without burning an attempt", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  for (const bad of ["", "   ", "a"]) {
    const v = await verifyRecoveryAnswer(db, bad);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "wrong");
  }
  assert.equal(storedValue(db).failed_attempts, 0, "junk input must not count against the owner");
  assert.equal((await verifyRecoveryAnswer(db, "kay")).ok, true);
});

test("setup rejects answers that are too short or too long", async () => {
  const db = fakeDb();
  assert.equal(await setRecoveryAnswer(db, "ab"), false);
  assert.equal(await setRecoveryAnswer(db, "a".repeat(200)), false);
  assert.equal(await setRecoveryAnswer(db, ""), false);
  assert.equal(storedValueSafe(db), null, "nothing may be written when setup is refused");
  assert.equal(await setRecoveryAnswer(db, "a".repeat(ANSWER_MIN_LENGTH)), true);
});

function storedValueSafe(db) {
  const row = db.state.rows.get("admin_recovery");
  return row ? JSON.parse(row.value) : null;
}

test("status reports configuration but never the answer", async () => {
  const db = fakeDb();
  const empty = await getRecoveryStatus(db);
  assert.equal(empty.configured, false);
  assert.equal(empty.question, null);

  await setRecoveryAnswer(db, "kay");
  const status = await getRecoveryStatus(db);
  assert.equal(status.configured, true);
  assert.equal(status.question, RECOVERY_QUESTION);

  // Serialise exactly as the API would and assert the secret is absent.
  const wire = JSON.stringify(status);
  assert.ok(!wire.includes("kay"), "status payload must not contain the answer");
  assert.ok(!wire.includes("scrypt$"), "status payload must not contain the hash");
});

test("a database error fails closed", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  db.state.failNext = 1;
  const v = await verifyRecoveryAnswer(db, "kay");
  assert.equal(v.ok, false, "an unreadable record must never grant access");
});

test("re-setting the answer replaces the hash and clears the counter", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  const firstHash = storedValue(db).answer_hash;
  await verifyRecoveryAnswer(db, "wrong");

  await setRecoveryAnswer(db, "kobe");
  assert.notEqual(storedValue(db).answer_hash, firstHash);
  assert.equal(storedValue(db).failed_attempts, 0);
  assert.equal((await verifyRecoveryAnswer(db, "kobe")).ok, true);
  assert.equal((await verifyRecoveryAnswer(db, "kay")).ok, false);
});

test("clearRecoveryFailures unlocks without touching the answer", async () => {
  const db = fakeDb();
  await setRecoveryAnswer(db, "kay");
  for (let i = 0; i < RECOVERY_LOCK_THRESHOLD; i++) await verifyRecoveryAnswer(db, `wrong${i}`);
  assert.equal((await getRecoveryStatus(db)).locked, true);

  await clearRecoveryFailures(db);
  assert.equal((await getRecoveryStatus(db)).locked, false);
  assert.equal((await verifyRecoveryAnswer(db, "kay")).ok, true);
});

test("unconfigured recovery reports not_configured rather than throwing", async () => {
  const db = fakeDb();
  const v = await verifyRecoveryAnswer(db, "kay");
  assert.equal(v.ok, false);
  assert.equal(v.reason, "not_configured");
});

test("answerError and normaliseAnswer behave predictably", () => {
  assert.equal(answerError(""), "Enter your answer to the security question.");
  assert.ok(answerError("ab").length > 0);
  assert.equal(answerError("kayembe"), "");
  assert.equal(normaliseAnswer("  KAY   The  Boss "), "kay the boss");
  assert.equal(normaliseAnswer(undefined), "");
  assert.equal(normaliseAnswer(42), "");
});