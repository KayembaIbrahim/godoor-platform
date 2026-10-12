/**
 * Hero banner core — pure logic, no database and no React.
 *
 * The rules under test are the ones that would embarrass us in front of a
 * paying sponsor: an unsafe URL, a banner that runs past its end date, or two
 * campaigns colliding in the same slot.
 */
import assert from "node:assert/strict";
import {
  EMPTY_BANNER,
  isBannerLive,
  normalizeBanner,
  pickBanner,
  scheduleSummary,
} from "@/lib/hero-banner-core";
import { safeUrl } from "@/lib/campaigns-core";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const NOW = Date.parse("2026-03-01T12:00:00.000Z");

/* ── normalisation ────────────────────────────────────────────────────────── */

ok("rejects a banner with no headline", () => {
  assert.equal(normalizeBanner({ title: "" }), null);
  assert.equal(normalizeBanner({}), null);
  assert.equal(normalizeBanner(null), null);
  assert.equal(normalizeBanner("nope"), null);
});

ok("keeps a sane banner", () => {
  const b = normalizeBanner({ title: "Free delivery today", subtitle: "Escrow protected" });
  assert.ok(b);
  assert.equal(b!.title, "Free delivery today");
  assert.equal(b!.enabled, true);
  assert.equal(b!.audience, "all");
});

ok("truncates over-long copy so it cannot break the layout", () => {
  const b = normalizeBanner({ title: "x".repeat(400), subtitle: "y".repeat(400) })!;
  assert.equal(b.title.length, 90);
  assert.equal(b.subtitle.length, 160);
});

/* ── URL safety ───────────────────────────────────────────────────────────── */

ok("rejects javascript: in the CTA", () => {
  const b = normalizeBanner({
    title: "Hi",
    ctaLabel: "Tap",
    ctaUrl: "javascript:alert(1)",
  })!;
  assert.equal(b.ctaUrl, null);
  assert.equal(b.ctaLabel, null, "a CTA with no destination must not render as a button");
});

ok("rejects data: in the image URL", () => {
  const b = normalizeBanner({ title: "Hi", imageUrl: "data:text/html,<script>" })!;
  assert.equal(b.imageUrl, null);
});

ok("rejects protocol-relative image URLs", () => {
  const b = normalizeBanner({ title: "Hi", imageUrl: "//evil.test/x.png" })!;
  assert.equal(b.imageUrl, null);
});

ok("keeps a valid https CTA paired with its label", () => {
  const b = normalizeBanner({
    title: "Hi",
    ctaLabel: "Order now",
    ctaUrl: "https://godoor.site/app",
  })!;
  assert.equal(b.ctaUrl, "https://godoor.site/app");
  assert.equal(b.ctaLabel, "Order now");
});

ok("drops a CTA label when the destination is unusable", () => {
  const b = normalizeBanner({
    title: "Hi",
    ctaLabel: "Order now",
    ctaUrl: "javascript:void(0)",
  })!;
  assert.equal(b.ctaLabel, null);
});

/* ── scheduling ───────────────────────────────────────────────────────────── */

ok("is not live before it starts", () => {
  const b = normalizeBanner({
    title: "Future",
    startsAt: new Date(NOW + 60_000).toISOString(),
  })!;
  assert.equal(isBannerLive(b, NOW), false);
});

ok("is not live at or after its end (exclusive bound)", () => {
  const end = new Date(NOW + 60_000).toISOString();
  const b = normalizeBanner({ title: "Ending", endsAt: end })!;
  assert.equal(isBannerLive(b, NOW), true);
  assert.equal(isBannerLive(b, Date.parse(end)), false, "must be exclusive at the boundary");
});

ok("is never live when disabled", () => {
  const b = normalizeBanner({ title: "Off", enabled: false })!;
  assert.equal(isBannerLive(b, NOW), false);
});

ok("respects audience", () => {
  const b = normalizeBanner({ title: "Riders", audience: "rider" })!;
  assert.equal(isBannerLive(b, NOW, "rider"), true);
  assert.equal(isBannerLive(b, NOW, "customer"), false);
  assert.equal(isBannerLive(b, NOW, "all"), false, "'all' means every audience, not every viewer");
});

ok("falls back to 'all' for an unknown audience value", () => {
  const b = normalizeBanner({ title: "X", audience: "wizard" })!;
  assert.equal(b.audience, "all");
});

ok("EMPTY_BANNER is never live", () => {
  assert.equal(isBannerLive(EMPTY_BANNER, NOW), false);
});

/* ── selection ────────────────────────────────────────────────────────────── */

ok("picks the highest priority live banner", () => {
  const picked = pickBanner(
    [
      { title: "Low", priority: 1 },
      { title: "High", priority: 9 },
      { title: "Mid", priority: 5 },
    ],
    NOW,
  );
  assert.equal(picked?.title, "High");
});

ok("skips expired and disabled entries instead of returning them", () => {
  const picked = pickBanner(
    [
      { title: "Dead", priority: 99, enabled: false },
      { title: "Gone", priority: 98, endsAt: new Date(NOW - 1000).toISOString() },
      { title: "Alive", priority: 1 },
    ],
    NOW,
  );
  assert.equal(picked?.title, "Alive");
});

ok("returns null when nothing is usable", () => {
  assert.equal(pickBanner([], NOW), null);
  assert.equal(pickBanner([{ title: "" }], NOW), null);
  assert.equal(pickBanner([null, undefined, 42], NOW), null);
});

ok("breaks a priority tie by most recently updated", () => {
  const picked = pickBanner(
    [
      { title: "Old", priority: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
      { title: "New", priority: 5, updatedAt: "2026-02-01T00:00:00.000Z" },
    ],
    NOW,
  );
  assert.equal(picked?.title, "New");
});

/* ── admin schedule copy ──────────────────────────────────────────────────── */

ok("summarises a future start", () => {
  const b = normalizeBanner({ title: "X", startsAt: new Date(NOW + 3 * 86_400_000).toISOString() })!;
  assert.match(scheduleSummary(b, NOW) ?? "", /^Starts in 3 days$/);
});

ok("summarises an expired slot honestly", () => {
  const b = normalizeBanner({ title: "X", endsAt: new Date(NOW - 1000).toISOString() })!;
  assert.equal(scheduleSummary(b, NOW), "Expired");
});

ok("says nothing when there is no schedule", () => {
  const b = normalizeBanner({ title: "X" })!;
  assert.equal(scheduleSummary(b, NOW), null);
});

/* ── the shared validator still behaves ───────────────────────────────────── */

ok("safeUrl is the validator the banner relies on", () => {
  assert.equal(safeUrl("https://a.test/x"), "https://a.test/x");
  assert.equal(safeUrl("/app"), "/app");
  assert.equal(safeUrl("javascript:alert(1)"), null);
});

/* ── report ───────────────────────────────────────────────────────────────── */

console.log(`\nhero-banner: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.error("  FAIL " + f);
  process.exit(1);
}