import assert from "node:assert/strict";
import "./register-alias.mjs";

/**
 * Promo resolution — the money guarantees.
 *
 * These are not UI tests. `/api/orders` uses `resolvePromoServer` to decide
 * what a customer is escrowed for, so anything wrong here is a wrong charge.
 * The suite deliberately covers the abuse cases an admin form can produce, not
 * just the happy path.
 */

const { PROMOS, resolvePromo, sanitizePromo, sanitizePromoTable, mergePromoTable,
        toPromoTable, featuredPromo, normalisePromoCode, PROMO_REASON_TEXT } =
  await import("../src/lib/promo.ts");
const { FIRST_ORDER_OFFER, firstOrderHeadline } = await import("../src/lib/first-order-offer.ts");

let pass = 0;
const fails = [];
const check = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") throw new Error("async in a sync check");
    pass++;
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
  }
};
const T = (code, subtotal, gross = subtotal) => ({ code, subtotalUgx: subtotal, grossUgx: gross });

/* ── 1. The shipped offer is what the storefront advertises ─────────────────── */
check("offer is 20%", () => assert.equal(FIRST_ORDER_OFFER.percent, 20));
check("offer code matches its percentage", () => assert.equal(FIRST_ORDER_OFFER.code, "FIRST20"));
check("headline renders the percentage", () =>
  assert.equal(firstOrderHeadline(), "First order 20% OFF"));
check("headline can render a live admin percentage", () =>
  assert.equal(firstOrderHeadline(35), "First order 35% OFF"));
check("headline defaults when no percentage is supplied", () =>
  assert.equal(firstOrderHeadline(undefined), "First order 20% OFF"));

/* ── 2. The advertised code really discounts ───────────────────────────────── */
check("the banner's code is in the default table", () =>
  assert.ok(PROMOS[FIRST_ORDER_OFFER.code], "FIRST20 missing from PROMOS"));
check("the advertised code is flagged featured", () =>
  assert.equal(PROMOS[FIRST_ORDER_OFFER.code].featured, true));
check("20% of 100,000 is 20,000", () => {
  const r = resolvePromo(T(FIRST_ORDER_OFFER.code, 100_000));
  assert.equal(r.ok, true);
  assert.equal(r.discountUgx, 20_000);
});
check("the discounted total is what gets charged", () => {
  const r = resolvePromo(T(FIRST_ORDER_OFFER.code, 100_000, 105_000));
  assert.equal(r.totalUgx, 85_000);
});
check("the advertised code is the featured default", () =>
  assert.equal(featuredPromo(PROMOS).code, FIRST_ORDER_OFFER.code));

/* ── 3. The server is the authority, the client cannot move a price ─────────── */
check("a client-sent discount field is simply not a parameter", () => {
  /* resolvePromo only accepts a code. There is no amount argument, so a
     tampered payload has nothing to tamper with. */
  const r = resolvePromo({ code: "GODOOR10", subtotalUgx: 10_000, grossUgx: 10_000, discount: 100 });
  assert.equal(r.discountUgx, 1_000); // the code's 10%, not the injected 100%
});
check("a percentage can never exceed the gross", () => {
  const table = { HUGE: { label: "x", discount: 90, type: "percent", minSubtotalUgx: 0, expiresAt: null, active: true } };
  const r = resolvePromo({ ...T("HUGE", 1_000, 500), table });
  assert.equal(r.discountUgx, 500);
  assert.equal(r.totalUgx, 0);
});
check("total never goes negative on a flat credit", () => {
  const table = { GIFT: { label: "x", discount: 9_000, type: "flat", minSubtotalUgx: 0, expiresAt: null, active: true } };
  const r = resolvePromo({ ...T("GIFT", 1_000, 1_200), table });
  assert.equal(r.totalUgx, 0);
});

/* ── 4. Codes are normalised the way a phone keyboard types them ───────────── */
check("lower case resolves", () => assert.equal(resolvePromo(T("first20", 20_000)).ok, true));
check("surrounding whitespace resolves", () => assert.equal(resolvePromo(T("  first20 ", 20_000)).ok, true));
check("normaliser trims and upper-cases", () => assert.equal(normalisePromoCode("  masaka20 "), "MASAKA20"));
check("a non-string code is rejected, not coerced", () => {
  assert.equal(normalisePromoCode(42), "");
  assert.equal(resolvePromo(T(42, 20_000)).ok, false);
});

/* ── 5. Rejection paths, and their distinct messages ────────────────────────── */
check("an unknown code is 'unknown'", () =>
  assert.equal(resolvePromo(T("NOPE", 20_000)).reason, "unknown"));
check("a missing code is 'missing', not 'unknown'", () =>
  assert.equal(resolvePromo(T("", 20_000)).reason, "missing"));
check("a switched-off code is 'inactive'", () => {
  const table = { OFF: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 0, expiresAt: null, active: false } };
  assert.equal(resolvePromo({ ...T("OFF", 20_000), table }).reason, "inactive");
});
check("an expired code is 'expired'", () => {
  const table = { OLD: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 0, expiresAt: "2020-01-01", active: true } };
  assert.equal(resolvePromo({ ...T("OLD", 20_000), table, now: Date.parse("2026-01-01") }).reason, "expired");
});
check("a code still valid on its expiry day", () => {
  const table = { NEW: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 0, expiresAt: "2026-06-01", active: true } };
  assert.equal(resolvePromo({ ...T("NEW", 20_000), table, now: Date.parse("2026-06-01T20:00:00Z") }).ok, true);
});
check("a basket below the minimum is refused", () => {
  const table = { BIG: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 50_000, expiresAt: null, active: true } };
  assert.equal(resolvePromo({ ...T("BIG", 10_000), table }).reason, "min_subtotal");
});
check("every reason has customer-facing copy", () => {
  for (const r of ["missing", "unknown", "inactive", "expired", "min_subtotal", "max_uses"]) {
    assert.equal(typeof PROMO_REASON_TEXT[r], "string", `no copy for ${r}`);
    assert.ok(PROMO_REASON_TEXT[r].length > 0);
  }
});

/* ── 6. Use caps ────────────────────────────────────────────────────────────── */
check("maxUses 0 means unlimited, not exhausted", () => {
  const table = { FREE: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 0, expiresAt: null, active: true, maxUses: 0, uses: 9999 } };
  assert.equal(resolvePromo({ ...T("FREE", 20_000), table }).ok, true,
    "a 0 cap must not read as 'used up'");
});
check("a fully claimed code is refused", () => {
  const table = { GONE: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 0, expiresAt: null, active: true, maxUses: 5, uses: 5 } };
  assert.equal(resolvePromo({ ...T("GONE", 20_000), table }).reason, "max_uses");
});
check("one use left still works", () => {
  const table = { LAST: { label: "x", discount: 20, type: "percent", minSubtotalUgx: 0, expiresAt: null, active: true, maxUses: 5, uses: 4 } };
  assert.equal(resolvePromo({ ...T("LAST", 20_000), table }).ok, true);
});

/* ── 7. What an admin may and may not enter ─────────────────────────────────── */
check("a normal percent promo survives sanitising", () => {
  const p = sanitizePromo({ code: "masaka20", discount: 20, type: "percent", minSubtotalUgx: 5000 });
  assert.equal(p.code, "MASAKA20");
  assert.equal(p.discount, 20);
  assert.equal(p.active, true);
});
check("a percent above the ceiling is clamped, not honoured", () => {
  assert.equal(sanitizePromo({ code: "TOOMUCH", discount: 100000, type: "percent" }).discount, 90);
});
check("a flat credit above the ceiling is clamped", () => {
  assert.equal(sanitizePromo({ code: "GIFT", discount: 99_999_999, type: "flat" }).discount, 500_000);
});
check("NaN cannot become a discount", () => assert.equal(sanitizePromo({ code: "NAN", discount: "abc" }), null));
check("Infinity cannot become a discount", () =>
  assert.equal(sanitizePromo({ code: "INF", discount: Infinity, type: "percent" }), null));
check("a negative discount is refused", () =>
  assert.equal(sanitizePromo({ code: "NEG", discount: -50, type: "percent" }), null));
check("a zero discount is refused", () =>
  assert.equal(sanitizePromo({ code: "ZERO", discount: 0, type: "percent" }), null));
check("an empty code is refused", () => assert.equal(sanitizePromo({ code: "", discount: 10 }), null));
check("a one-character code is refused", () => assert.equal(sanitizePromo({ code: "A", discount: 10 }), null));
check("a code with spaces is refused", () =>
  assert.equal(sanitizePromo({ code: "MASAKA 20", discount: 10 }), null));
check("a code with punctuation is refused", () =>
  assert.equal(sanitizePromo({ code: "DROP TABLE", discount: 10 }), null));
check("a malformed expiry is dropped, not trusted", () => {
  assert.equal(sanitizePromo({ code: "OK1", discount: 10, expiresAt: "whenever" }).expiresAt, null);
});
check("a valid expiry is kept", () => {
  assert.equal(sanitizePromo({ code: "OK2", discount: 10, expiresAt: "2026-12-31" }).expiresAt, "2026-12-31");
});
check("active:false is honoured rather than defaulted to on", () =>
  assert.equal(sanitizePromo({ code: "OFFME", discount: 10, active: false }).active, false));
check("a blank label gets a generated one", () => {
  assert.ok(sanitizePromo({ code: "NOLABEL", discount: 25, type: "percent", label: "  " }).label.includes("25"));
});

/* ── 8. Table-level rules ──────────────────────────────────────────────────── */
check("a duplicate code rejects the whole save", () =>
  assert.equal(sanitizePromoTable([
    { code: "SAME", discount: 10 },
    { code: "SAME", discount: 20 },
  ]), null));
check("two featured codes reject the whole save", () =>
  assert.equal(sanitizePromoTable([
    { code: "ONE", discount: 10, featured: true },
    { code: "TWO", discount: 10, featured: true },
  ]), null));
check("exactly one featured code is accepted", () => {
  const list = sanitizePromoTable([
    { code: "ONE", discount: 10, featured: true },
    { code: "TWO", discount: 10 },
  ]);
  assert.equal(list.length, 2);
});
check("one invalid entry rejects the whole table", () =>
  assert.equal(sanitizePromoTable([{ code: "GOOD", discount: 10 }, { code: "bad code!", discount: 10 }]), null));
check("a non-array is rejected", () => {
  assert.equal(sanitizePromoTable({}), null);
  assert.equal(sanitizePromoTable(null), null);
});
check("an oversized table is rejected", () =>
  assert.equal(sanitizePromoTable(Array.from({ length: 41 }, (_, i) => ({ code: `C${i}`, discount: 5 }))), null));

/* ── 9. Merging admin entries over the defaults ────────────────────────────── */
check("an admin entry retunes a shipped code", () => {
  const merged = mergePromoTable(sanitizePromoTable([{ code: "GODOOR10", discount: 30, type: "percent" }]));
  assert.equal(merged.GODOOR10.discount, 30);
});
check("retuning a code does not resurrect the default", () =>
  assert.equal(resolvePromo({ ...T("GODOOR10", 10_000), table: mergePromoTable(sanitizePromoTable([{ code: "GODOOR10", discount: 30, type: "percent" }])) }).discountUgx, 3_000));
check("an admin entry can add a brand new code", () => {
  const merged = mergePromoTable(sanitizePromoTable([{ code: "MASAKA25", discount: 25, type: "percent" }]));
  assert.ok(merged.MASAKA25);
  assert.equal(resolvePromo({ ...T("MASAKA25", 20_000), table: merged }).discountUgx, 5_000);
});
check("with no saved table the defaults are intact", () => {
  const merged = mergePromoTable(null);
  assert.equal(merged[FIRST_ORDER_OFFER.code].discount, 20);
});
check("an admin can feature a different code than the default", () => {
  const list = sanitizePromoTable([{ code: "MASAKA30", discount: 30, type: "percent", featured: true }]);
  assert.equal(featuredPromo(mergePromoTable(list)).code, "MASAKA30");
});
check("a featured but switched-off code falls back", () => {
  const list = sanitizePromoTable([{ code: "MASAKA30", discount: 30, type: "percent", featured: true, active: false }]);
  assert.equal(featuredPromo(mergePromoTable(list)).code, FIRST_ORDER_OFFER.code);
});
check("toPromoTable indexes by code", () => {
  const t = toPromoTable(sanitizePromoTable([{ code: "AAA", discount: 10, type: "percent" }]));
  assert.ok(t.AAA);
});

/* ── 10. Rounding must not leak fractions of a shilling ─────────────────────── */
check("percent discounts round to whole shillings", () => {
  const table = { R: { label: "x", discount: 33, type: "percent", minSubtotalUgx: 0, expiresAt: null, active: true } };
  const r = resolvePromo({ ...T("R", 999), table });
  assert.equal(Number.isInteger(r.discountUgx), true);
  assert.equal(r.discountUgx, 330); // 329.67 rounded
});
check("the total always equals gross minus discount", () => {
  for (const sub of [1, 999, 5_000, 123_457, 1_000_000]) {
    for (const gross of [sub, sub + 2_000, sub + 12_500]) {
      const r = resolvePromo(T(FIRST_ORDER_OFFER.code, sub, gross));
      if (r.ok) assert.equal(r.totalUgx, gross - r.discountUgx, `mismatch at ${sub}/${gross}`);
    }
  }
});

/* ── report ────────────────────────────────────────────────────────────────── */
console.log(`\npromo: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log("  FAIL " + f);
  process.exit(1);
}