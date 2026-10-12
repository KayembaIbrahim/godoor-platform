/**
 * Category-rail navigation round trip.
 *
 * The home rail now links to `/browse/<canonical id>` instead of filtering in
 * place. That only works if the encoded path resolves back to the same category
 * the chip was built from — otherwise every chip becomes an empty page, which is
 * exactly the bug this file exists to catch.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd()}/scripts/`));

const { browseHref, canonicalCategoryForSlug, merchantInSlug } = await import(
  "../src/lib/service-slugs.ts"
);
const { CATEGORIES } = await import("../src/lib/categories.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

console.log(`\n=== service-slugs: ${CATEGORIES.length} canonical categories ===\n`);

// 1. The encoded path round trips back to the exact same canonical id.
console.log("[1] every canonical id round trips through its browse path");
const bad = [];
for (const c of CATEGORIES) {
  const href = browseHref(c.id);
  const slug = decodeURIComponent(href.replace("/browse/", ""));
  const back = canonicalCategoryForSlug(slug);
  if (back !== c.id) bad.push({ id: c.id, back });
}
check("round trip mismatches", bad, []);
check("all resolve", bad.length, 0);

// 2. No raw space or ampersand can leak into a path segment.
console.log("[2] path segments are URL-safe");
const unsafe = CATEGORIES.filter((c) => /[\s&?#]/.test(browseHref(c.id).replace("/browse/", "")));
check("unsafe segments", unsafe.map((c) => c.id), []);

// 3. A merchant in that category is matched by that slug (the empty-page bug).
console.log("[3] merchants are matched by their own category's slug");
let missed = [];
for (const c of CATEGORIES) {
  if (!merchantInSlug(c.id, decodeURIComponent(browseHref(c.id).replace("/browse/", "")))) {
    missed.push(c.id);
  }
}
check("categories that matched nothing", missed, []);
check("all match", missed.length, 0);

// 4. Real-world free text still resolves (trailing spaces, & variants).
console.log("[4] messy real-world category text");
// "Furniture" is deliberately not asserted: it is not one of the canonical ids,
// so a merchant registered that way falls through to raw text rather than
// resolving to Home & Kitchen. That is pre-existing data behaviour, not
// something the slug layer should invent a mapping for.
check("trailing space on a real id", merchantInSlug("Pharmacy ", "Pharmacy"), true);
check("& spacing variant", merchantInSlug("Food  &  Restaurants", "food"), true);
check("short form", merchantInSlug("Groceries", "mart"), true);
check("unrelated text", merchantInSlug("Furniture", "pharma"), false);
check("empty text", merchantInSlug("", "food"), false);
check("null text", merchantInSlug(null, "food"), false);

// 5. The three headline services keep their curated hint matching.
console.log("[5] headline service slugs");
check("food", merchantInSlug("Food & Restaurants", "food"), true);
check("mart", merchantInSlug("Supermarket", "mart"), true);
check("pharma", merchantInSlug("Pharmacy", "pharma"), true);

// 6. Untrusted URL input must not throw.
console.log("[6] hostile URL input returns null, never throws");
for (const bad_in of ["%", "%zz", "%%%", "..", "<script>", "%%%2", "%E0%A4%A"]) {
  let out;
  let threw = null;
  try {
    out = canonicalCategoryForSlug(bad_in);
  } catch (e) {
    threw = e.message;
  }
  check(`canonicalCategoryForSlug(${JSON.stringify(bad_in)})`, threw ?? out, threw ? "THREW" : null);
}

console.log(`\npassed ${pass}  failed ${fail}\n`);
process.exit(fail ? 1 : 0);