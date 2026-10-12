/**
 * Tests for the flyer popup decision rules.
 *
 * Runs the real module in plain Node (Node 24 strips the types natively), not a
 * re-implementation — a test that reimplements the logic proves nothing.
 *
 *   node scripts/verify-campaigns.mjs
 */

import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_TONES,
  dismiss,
  isCampaignLive,
  isDismissed,
  pickCampaign,
  pruneDismissals,
  readDismissals,
  resolveActiveCampaigns,
  safeUrl,
  sanitizeCampaign,
  sanitizeCampaigns,
  slugify,
} from "../src/lib/campaigns-core.ts";

let pass = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}: ${e && e.message ? e.message : e}`);
  }
}

function eq(actual, expected, what = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`);
}

function ok(v, what) {
  if (!v) throw new Error(`${what} — expected truthy`);
}

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();

/* ── URL safety ─────────────────────────────────────────────────────────────
 * Admin-authored content lands in href/src. This is the XSS boundary. */
t("safeUrl allows https", () => ok(safeUrl("https://godoor.site/flyer.jpg"), "https allowed"));
t("safeUrl allows http", () => ok(safeUrl("http://example.com/a.png"), "http allowed"));
t("safeUrl allows relative path", () => eq(safeUrl("/flyers/offer.jpg"), "/flyers/offer.jpg"));
t("safeUrl trims whitespace", () => eq(safeUrl("  https://a.co/x.png  "), "https://a.co/x.png"));
t("safeUrl blocks javascript:", () => eq(safeUrl("javascript:alert(1)"), null, "javascript:"));
t("safeUrl blocks JaVaScRiPt: mixed case", () => eq(safeUrl("JaVaScRiPt:alert(1)"), null, "mixed case"));
t("safeUrl blocks javascript: with newline", () => eq(safeUrl("java\nscript:alert(1)"), null, "newline"));
t("safeUrl blocks data:", () => eq(safeUrl("data:text/html;base64,PHNjcmlwdD4="), null, "data:"));
t("safeUrl blocks vbscript:", () => eq(safeUrl("vbscript:msgbox(1)"), null, "vbscript:"));
t("safeUrl blocks protocol-relative //evil.com", () => eq(safeUrl("//evil.com/x.png"), null, "//"));
t("safeUrl blocks file:", () => eq(safeUrl("file:///etc/passwd"), null, "file:"));
t("safeUrl rejects non-strings", () => {
  eq(safeUrl(null), null);
  eq(safeUrl(42), null);
  eq(safeUrl({}), null);
});
t("safeUrl rejects empty", () => eq(safeUrl("   "), null));

/* ── slugify ──────────────────────────────────────────────────────────────── */
t("slugify lowercases and dashes", () => eq(slugify("Free Delivery!"), "free-delivery"));
t("slugify strips leading/trailing dashes", () => eq(slugify("--hi--"), "hi"));
t("slugify falls back on empty", () => eq(slugify("!!!"), "campaign"));
t("slugify caps length", () => ok(slugify("x".repeat(200)).length <= 64, "capped"));
t("slugify produces a safe relative path", () =>
  eq(safeUrl(`/${slugify("../../etc/passwd")}`) !== null, true, "no traversal"));

/* ── sanitizeCampaign ─────────────────────────────────────────────────────── */
t("sanitizeCampaign builds a valid campaign", () => {
  const c = sanitizeCampaign({ title: "Hello", body: "World" }, NOW);
  eq(c.title, "Hello");
  eq(c.body, "World");
  eq(c.tone, "brand", "default tone");
  eq(c.audience, "all", "default audience");
  eq(c.enabled, true, "default enabled");
  eq(c.dismissDays, 7, "default dismissal window");
});
t("sanitizeCampaign returns null with no title and no image", () =>
  eq(sanitizeCampaign({ body: "orphan" }, NOW), null));
t("sanitizeCampaign allows an image-only card", () =>
  ok(sanitizeCampaign({ imageUrl: "https://a.co/f.png" }, NOW), "image-only is allowed"));
t("sanitizeCampaign strips an unsafe CTA url", () => {
  const c = sanitizeCampaign({ title: "t", ctaLabel: "Go", ctaUrl: "javascript:alert(1)" }, NOW);
  eq(c.ctaUrl, null, "javascript CTA dropped");
  eq(c.ctaLabel, "Go", "label kept");
});
t("sanitizeCampaign falls back on an unknown tone", () =>
  eq(sanitizeCampaign({ title: "t", tone: "neon" }, NOW).tone, "brand"));
t("sanitizeCampaign falls back on an unknown audience", () =>
  eq(sanitizeCampaign({ title: "t", audience: "aliens" }, NOW).audience, "all"));
t("sanitizeCampaign clamps priority", () =>
  eq(sanitizeCampaign({ title: "t", priority: 9999 }, NOW).priority, 100));
t("sanitizeCampaign clamps dismissDays", () =>
  eq(sanitizeCampaign({ title: "t", dismissDays: -5 }, NOW).dismissDays, 0));
t("sanitizeCampaign truncates an over-long title", () =>
  eq(sanitizeCampaign({ title: "x".repeat(500) }, NOW).title.length, 120));
t("sanitizeCampaign drops an unparseable date", () =>
  eq(sanitizeCampaign({ title: "t", startsAt: "not-a-date" }, NOW).startsAt, null));
t("sanitizeCampaign rejects non-objects", () => {
  eq(sanitizeCampaign(null, NOW), null);
  eq(sanitizeCampaign("nope", NOW), null);
});

/* ── sanitizeCampaigns ────────────────────────────────────────────────────── */
t("sanitizeCampaigns drops unusable entries", () =>
  eq(sanitizeCampaigns([{ title: "ok" }, { body: "no title" }, null], NOW).length, 1));
t("sanitizeCampaigns dedupes ids, first wins", () => {
  const out = sanitizeCampaigns([{ id: "a", title: "first" }, { id: "a", title: "second" }], NOW);
  eq(out.length, 1);
  eq(out[0].title, "first");
});
t("sanitizeCampaigns returns [] for non-arrays", () => {
  eq(sanitizeCampaigns(null, NOW), []);
  eq(sanitizeCampaigns({ nope: 1 }, NOW), []);
  eq(sanitizeCampaigns("nope", NOW), []);
});

/* ── Scheduling ───────────────────────────────────────────────────────────── */
const mk = (over = {}) => ({ ...sanitizeCampaign({ title: "t", ...over }, NOW) });

t("a disabled campaign is never live", () =>
  eq(isCampaignLive(mk({ enabled: false }), "customer", NOW), false));
t("a campaign with no schedule is live", () =>
  eq(isCampaignLive(mk(), "customer", NOW), true));
t("startsAt is inclusive", () =>
  eq(isCampaignLive(mk({ startsAt: NOW_ISO }), "customer", NOW), true, "at the boundary"));
t("a campaign scheduled for later is not live", () =>
  eq(isCampaignLive(mk({ startsAt: new Date(NOW + 60_000).toISOString() }), "customer", NOW), false));
t("endsAt is exclusive", () =>
  eq(isCampaignLive(mk({ endsAt: NOW_ISO }), "customer", NOW), false, "at the boundary"));
t("an expired campaign is not live", () =>
  eq(isCampaignLive(mk({ endsAt: new Date(NOW - 1000).toISOString() }), "customer", NOW), false));
t("back-to-back campaigns do not both claim the boundary", () => {
  const a = mk({ id: "a", endsAt: NOW_ISO });
  const b = mk({ id: "b", startsAt: NOW_ISO });
  eq(isCampaignLive(a, "customer", NOW), false, "a ended");
  eq(isCampaignLive(b, "customer", NOW), true, "b started");
});
t("audience 'all' reaches a rider", () =>
  eq(isCampaignLive(mk({ audience: "all" }), "rider", NOW), true));
t("a customer-only campaign skips a rider", () =>
  eq(isCampaignLive(mk({ audience: "customer" }), "rider", NOW), false));
t("a customer-only campaign reaches a customer", () =>
  eq(isCampaignLive(mk({ audience: "customer" }), "customer", NOW), true));
t("audience 'all' reaches a signed-out visitor", () =>
  eq(isCampaignLive(mk({ audience: "all" }), null, NOW), true, "null role sees 'all'"));
t("a targeted campaign skips a signed-out visitor", () =>
  eq(isCampaignLive(mk({ audience: "rider" }), null, NOW), false, "null role is not 'rider'"));

/* ── Ordering ─────────────────────────────────────────────────────────────── */
t("higher priority sorts first", () => {
  const list = [mk({ id: "low", priority: 0 }), mk({ id: "high", priority: 10 })];
  eq(resolveActiveCampaigns(list, "customer", NOW)[0].id, "high");
});
t("ties break on most recently updated", () => {
  const old = { ...mk({ id: "old" }), updatedAt: "2026-01-01T00:00:00.000Z" };
  const fresh = { ...mk({ id: "fresh" }), updatedAt: "2026-10-01T00:00:00.000Z" };
  eq(resolveActiveCampaigns([old, fresh], "customer", NOW)[0].id, "fresh");
});
t("disabled and expired campaigns are filtered out", () => {
  const list = [
    mk({ id: "off", enabled: false }),
    mk({ id: "gone", endsAt: new Date(NOW - 1).toISOString() }),
    mk({ id: "ok" }),
  ];
  eq(resolveActiveCampaigns(list, "customer", NOW).map((c) => c.id), ["ok"]);
});

/* ── Dismissal ────────────────────────────────────────────────────────────── */
t("a campaign is shown when never dismissed", () =>
  eq(isDismissed({}, mk(), NOW), false));
t("a dismissal suppresses the campaign", () => {
  const c = mk({ dismissDays: 7 });
  eq(isDismissed(dismiss({}, c, NOW), c, NOW), true);
});
t("a dismissal expires after its window", () => {
  const c = mk({ dismissDays: 7 });
  const map = dismiss({}, c, NOW);
  const later = NOW + 8 * 86_400_000;
  eq(isDismissed(map, c, later), false, "expired after 8 days");
});
t("a dismissal survives just under its window", () => {
  const c = mk({ dismissDays: 7 });
  const map = dismiss({}, c, NOW);
  eq(isDismissed(map, c, NOW + 6 * 86_400_000), true, "still suppressed at 6 days");
});
t("dismissDays 0 means forever", () => {
  const c = mk({ dismissDays: 0 });
  const map = dismiss({}, c, NOW);
  eq(isDismissed(map, c, NOW + 400 * 86_400_000), true, "still suppressed");
});
t("dismissals are tracked per campaign", () => {
  const a = mk({ id: "a", dismissDays: 7 });
  const b = mk({ id: "b", dismissDays: 7 });
  const map = dismiss({}, a, NOW);
  eq(isDismissed(map, a, NOW), true, "a dismissed");
  eq(isDismissed(map, b, NOW), false, "b untouched");
});
t("dismiss does not mutate the original map", () => {
  const before = {};
  dismiss(before, mk(), NOW);
  eq(before, {}, "original untouched");
});

t("pruneDismissals drops stale entries", () => {
  const map = { a: NOW, b: NOW - 400 * 86_400_000 };
  eq(Object.keys(pruneDismissals(map, NOW)), ["a"]);
});
t("pruneDismissals rejects future timestamps", () =>
  eq(Object.keys(pruneDismissals({ a: NOW + 10_000 }, NOW)), []));
t("pruneDismissals rejects non-numbers", () =>
  eq(Object.keys(pruneDismissals({ a: "x" }, NOW)), []));

/* ── readDismissals (localStorage is user-writable) ───────────────────────── */
t("readDismissals parses valid JSON", () =>
  eq(readDismissals('{"a":1700000000000}').a, 1700000000000));
t("readDismissals survives malformed JSON", () => eq(readDismissals("{oops"), {}));
t("readDismissals survives an array", () => eq(readDismissals("[1,2]"), {}));
t("readDismissals survives null", () => eq(readDismissals(null), {}));
t("readDismissals survives a string value", () => eq(readDismissals('{"a":"x"}'), {}));
t("readDismissals survives NaN", () => eq(readDismissals('{"a":NaN}'), {}));

/* ── pickCampaign ─────────────────────────────────────────────────────────── */
t("pickCampaign returns the highest-priority live campaign", () => {
  const list = [mk({ id: "low" }), mk({ id: "high", priority: 5 })];
  eq(pickCampaign(list, "customer", {}, NOW).id, "high");
});
t("pickCampaign skips a dismissed one and returns the next", () => {
  const top = mk({ id: "top", priority: 5, dismissDays: 7 });
  const next = mk({ id: "next", priority: 1, dismissDays: 7 });
  const map = dismiss({}, top, NOW);
  eq(pickCampaign([top, next], "customer", map, NOW).id, "next", "fell through to next");
});
t("pickCampaign returns null when everything is dismissed", () => {
  const only = mk({ id: "only", dismissDays: 7 });
  const map = dismiss({}, only, NOW);
  eq(pickCampaign([only], "customer", map, NOW), null);
});
t("pickCampaign returns null with no campaigns", () =>
  eq(pickCampaign([], "customer", {}, NOW), null));
t("pickCampaign respects audience", () => {
  const riderOnly = mk({ id: "r", audience: "rider" });
  eq(pickCampaign([riderOnly], "customer", {}, NOW), null, "hidden from a customer");
  eq(pickCampaign([riderOnly], "rider", {}, NOW).id, "r", "shown to a rider");
});

/* ── Enums ────────────────────────────────────────────────────────────────── */
t("tone and audience enums are what the UI offers", () => {
  ok(CAMPAIGN_TONES.includes("brand") && CAMPAIGN_TONES.includes("purple"), "tones");
  ok(CAMPAIGN_AUDIENCES.length === 4, "four audiences");
});

/* ── Report ───────────────────────────────────────────────────────────────── */
console.log(`\ncampaigns: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("all flyer-campaign rules hold\n");
