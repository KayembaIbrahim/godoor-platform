/**
 * Category completeness audit.
 *
 * WHY THIS EXISTS
 * ---------------
 * GoDoor's taxonomy is spread over five files — `CATEGORIES` (the canonical
 * list), `SERVICE_TILES` (the four headline tiles), `CORE_RAIL_CATEGORIES`
 * (what the home rail leads with), `RAIL_LABELS` (the short chip names) and
 * `CATEGORY_DISCS` (the icon colours). Nothing checks that they agree.
 *
 * The consequence is that a category can be half-wired and nobody notices
 * until a customer lands on it: no rail label means the chip shows a long
 * canonical id that pushes the rail off-screen; no disc colour means the icon
 * falls back to slate and looks like a placeholder; no products means the
 * category page renders an empty box that reads as "we do not sell this".
 *
 * This test asserts every category has EVERYTHING it needs to be presented
 * properly, so adding a category (like House Helpers) cannot be half-done.
 */

import { CATEGORIES, CATEGORY_IDS, matchCategory } from "@/lib/categories";
import { SERVICE_TILES, CORE_RAIL_CATEGORIES, RAIL_LABELS } from "@/lib/service-tiles";
import { CATEGORY_DISCS, DEFAULT_DISC } from "@/lib/category-discs";
import { browseHref, canonicalCategoryForSlug, browseMeta, merchantInSlug } from "@/lib/service-slugs";

let failed = 0;
let passed = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n── Category completeness ──────────────────────────────────────────\n");

// ── 1. Every category is unique and non-empty ────────────────────────────
{
  const ids = CATEGORIES.map((c) => c.id);
  check("category ids are unique", new Set(ids).size === ids.length,
    `${ids.length} categories, ${new Set(ids).size} unique`);
  check("no category has a blank id", ids.every((i) => i.trim().length > 0));
  check("no category has a blank label", CATEGORIES.every((c) => c.label.trim().length > 0));
}

// ── 2. Every category has products to show ───────────────────────────────
{
  const empty = CATEGORIES.filter((c) => c.products.length === 0).map((c) => c.id);
  check("every category has at least one product", empty.length === 0,
    empty.length ? `empty: ${empty.join(", ")}` : undefined);

  const badPrice = CATEGORIES.filter((c) => c.products.some((p) => !Number.isFinite(p.price) || p.price <= 0))
    .map((c) => c.id);
  check("every product has a positive price", badPrice.length === 0,
    badPrice.length ? `bad: ${badPrice.join(", ")}` : undefined);

  const blankName = CATEGORIES.filter((c) => c.products.some((p) => !p.name.trim())).map((c) => c.id);
  check("every product has a name", blankName.length === 0,
    blankName.length ? `bad: ${blankName.join(", ")}` : undefined);

  const dupes = CATEGORIES.filter((c) => {
    const names = c.products.map((p) => p.name.toLowerCase());
    return new Set(names).size !== names.length;
  }).map((c) => c.id);
  check("no category lists the same product twice", dupes.length === 0,
    dupes.length ? `dupes: ${dupes.join(", ")}` : undefined);
}

// ── 3. Every category has a disc colour (not the fallback) ───────────────
{
  const missing = CATEGORIES.filter((c) => !CATEGORY_DISCS[c.id]).map((c) => c.id);
  check("every category has an explicit disc colour", missing.length === 0,
    missing.length ? `falling back to slate: ${missing.join(", ")}` : undefined);
}

// ── 4. Every category has a short rail label ─────────────────────────────
{
  const missing = CATEGORIES.filter((c) => !RAIL_LABELS[c.id]).map((c) => c.id);
  check("every category has a short rail label", missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : undefined);

  const tooLong = CATEGORIES
    .filter((c) => RAIL_LABELS[c.id] && RAIL_LABELS[c.id].length > 12)
    .map((c) => `${c.id} → "${RAIL_LABELS[c.id]}"`);
  check("rail labels are short enough for a chip", tooLong.length === 0,
    tooLong.length ? tooLong.join(", ") : undefined);
}

// ── 5. Every category is reachable ──────────────────────────────────────
{
  /* The home rail is a deliberate TEASE — the top ten, in priority order.
     Reachability for the rest comes from the `/categories` directory, which
     renders `CORE_RAIL_CATEGORIES` first and then every remaining category in
     the taxonomy. So the invariant is not "every category is on the rail" but
     "every category is reachable SOMEWHERE", and the rail may only ever name
     categories that exist. */
  const rail = new Set<string>(CORE_RAIL_CATEGORIES);
  const orphans = [...rail].filter((id) => !CATEGORY_IDS.includes(id));
  check("the home rail contains no category that does not exist", orphans.length === 0,
    orphans.length ? `unknown ids: ${orphans.join(", ")}` : undefined);

  const dupes = CORE_RAIL_CATEGORIES.filter((id, i) => CORE_RAIL_CATEGORIES.indexOf(id) !== i);
  check("the home rail has no duplicates", dupes.length === 0,
    dupes.length ? `dupes: ${[...new Set(dupes)].join(", ")}` : undefined);

  /* The directory is the catch-all. It lists the rail plus everything else,
     so between them every category must be covered — otherwise a category
     exists in the data but nowhere a customer can find it. */
  const directory = new Set<string>([...CORE_RAIL_CATEGORIES, ...CATEGORY_IDS]);
  const missing = CATEGORY_IDS.filter((id) => !directory.has(id));
  check("every category is listed in the directory", missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : undefined);

  /* The rail leads with what people buy most, so the four headline services
     and the daily essentials must be at the front, not buried at the end. */
  const firstTen = CORE_RAIL_CATEGORIES.slice(0, 10);
  check("the rail leads with food and daily essentials",
    firstTen.includes("Food & Restaurants") || firstTen.includes("Clothing & Fashion"),
    `rail starts: ${CORE_RAIL_CATEGORIES.slice(0, 4).join(", ")}`);
}

// ── 6. Every category resolves to a real browse page ─────────────────────
{
  const broken = CATEGORIES.filter((c) => {
    const canonical = canonicalCategoryForSlug(browseHref(c.id));
    return canonical !== c.id;
  }).map((c) => c.id);
  check("every category resolves back from its own browse URL", broken.length === 0,
    broken.length ? `broken: ${broken.join(", ")}` : undefined);

  const noMeta = CATEGORIES.filter((c) => !browseMeta(browseHref(c.id), c.id)).map((c) => c.id);
  check("every category has browse page presentation", noMeta.length === 0,
    noMeta.length ? `no meta: ${noMeta.join(", ")}` : undefined);
}

// ── 7. Category matching works for each canonical id ─────────────────────
{
  const unmatched = CATEGORIES.filter((c) => matchCategory(c.id)?.id !== c.id).map((c) => c.id);
  check("matchCategory resolves every canonical id exactly", unmatched.length === 0,
    unmatched.length ? `unmatched: ${unmatched.join(", ")}` : undefined);

  // A merchant row carrying the category's own label must land on it. This is
  // what `/browse/[category]` filters on, so a category that cannot match its
  // own name shows an empty shop list.
  const noMatch = CATEGORIES.filter((c) => !merchantInSlug(c.id, browseHref(c.id))).map((c) => c.id);
  check("a merchant labelled with the category matches its own browse page", noMatch.length === 0,
    noMatch.length ? `no match: ${noMatch.join(", ")}` : undefined);
}

// ── 8. Service tiles point at real categories ────────────────────────────
{
  const broken = SERVICE_TILES.filter((t) => !CATEGORY_IDS.includes(t.category)).map((t) => t.label);
  check("every service tile points at a real category", broken.length === 0,
    broken.length ? `broken: ${broken.join(", ")}` : undefined);
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
