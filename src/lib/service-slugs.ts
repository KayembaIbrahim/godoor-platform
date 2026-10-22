/**
 * Service-tile → category mapping.
 *
 * The home grid used to call `onSelectCategory("Groceries & Market")` inline in
 * the tile markup and compare against `merchants.category` elsewhere. That is
 * how the GoMart tile ended up producing an empty shop list: the string was
 * hand-typed in two places, and one of them drifted ("Groceries" vs
 * "Groceries & Market").
 *
 * This is the single place a service tile and its browse page agree on. The
 * tile links to `/browse/<slug>`; the page resolves the same slug back to the
 * canonical `CATEGORIES` id. If the two ever disagree again it is a bug here,
 * not scattered through JSX.
 *
 * Slugs are URL-safe and stable. The canonical ids contain spaces and `&`, so
 * they must never be put in a path raw.
 */

import { matchCategory, categoryMatches, type CategoryInfo } from "@/lib/categories";
import { RAIL_LABELS } from "@/lib/service-tiles";

export type ServiceSlug = "food" | "mart" | "pharma";

/** Slug → the free-text hints a merchant row may carry for that service. */
const SERVICE_HINTS: Record<ServiceSlug, string[]> = {
  food: ["Food & Restaurants"],
  mart: ["Groceries & Market", "Groceries", "Supermarket", "Market"],
  pharma: ["Pharmacy", "Pharmaceuticals", "Health & Wellness"],
};

export const SERVICE_SLUGS = Object.keys(SERVICE_HINTS) as ServiceSlug[];

/** Presentation copy for the service header. Kept beside the mapping on purpose. */
export const SERVICE_META: Record<
  ServiceSlug,
  { title: string; blurb: string; ring: string; wash: string }
> = {
  food: {
    title: "GoFood",
    blurb: "Hot meals from kitchens and restaurants near you.",
    ring: "bg-amber-500/10 ring-amber-500/20",
    wash: "from-amber-500/10",
  },
  mart: {
    title: "GoMart",
    blurb: "Fresh market, groceries and household staples.",
    ring: "bg-emerald-500/10 ring-emerald-500/20",
    wash: "from-emerald-500/10",
  },
  pharma: {
    title: "GoPharma",
    blurb: "Medicines, wellness and first-aid essentials.",
    ring: "bg-blue-500/10 ring-blue-500/20",
    wash: "from-blue-500/10",
  },
};

/** The canonical `CATEGORIES` id a slug browses, or null if the slug is unknown. */
export function canonicalCategoryForSlug(slug: string | undefined): string | null {
  if (!slug) return null;
  const s = slug.trim().toLowerCase();
  for (const key of SERVICE_SLUGS) {
    if (key === s) {
      // Route through `matchCategory` so the page can never browse an id that
      // is not a real category, even if the hint list above is edited wrongly.
      const resolved = matchCategory(SERVICE_HINTS[key][0]);
      if (resolved) return resolved.id;
    }
  }
  // Tolerate the raw canonical id too, so an old link still lands somewhere sane.
  // The slug comes straight from the URL, so a malformed percent-escape must
  // yield "unknown service" rather than throw URIError and 500 the page.
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const direct = matchCategory(decoded.replace(/-/g, " "));
  return direct ? direct.id : null;
}

/** Does a merchant row belong to this service? */
export function merchantInSlug(rawCategory: string | null | undefined, slug: string): boolean {
  const key = slug.trim().toLowerCase() as ServiceSlug;
  const hints = SERVICE_HINTS[key];

  if (!hints) {
    // Not one of the three headline services, so this is a raw canonical category
    // id from the home category rail ("Clothing & Fashion", "Petrol & Fuel"…).
    //
    // Returning false here was a real defect: `canonicalCategoryForSlug`
    // deliberately tolerates a raw id so old links still resolve, so the browse
    // page got a non-null `canonical` and then filtered every merchant out —
    // an empty page rather than an honest "unknown service". Falling back to the
    // shared resolver makes every category on the rail browsable, so adding a
    // dedicated page per category later needs no change here.
    const canonical = canonicalCategoryForSlug(slug);
    return canonical ? categoryMatches(rawCategory, canonical) : false;
  }

  const s = (rawCategory || "")
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ");
  if (!s) return false;
  return hints.some((h) => {
    const norm = h.toLowerCase().replace(/\s*&\s*/g, " & ").replace(/\s+/g, " ");
    return s === norm || s.includes(norm) || norm.includes(s);
  });
}

export function serviceMeta(slug: string): { title: string; blurb: string; ring: string; wash: string } | null {
  return SERVICE_META[slug.trim().toLowerCase() as ServiceSlug] ?? null;
}

/**
 * The presentation for a browse page, whether or not the slug is a headline
 * service.
 *
 * WHY THIS EXISTS
 * ---------------
 * `serviceMeta` only knows `food`, `mart` and `pharma`, and the browse page
 * gated its whole render on `meta`. So a chip for "Beauty & Personal Care" or
 * "Petrol & Fuel" resolved a perfectly good canonical id and then rendered
 * "That service isn't available" — 11 of the 14 chips on the home category rail
 * were dead ends, and the empty state they were supposed to reach ("No beauty &
 * personal care yet, we're onboarding partners") was unreachable code.
 *
 * Deriving the presentation from the category itself means every category the
 * platform lists has a real destination, so adding a category needs no change
 * here. Headline services keep their written copy.
 */
export function browseMeta(
  slug: string,
  canonical: string | null,
): { title: string; blurb: string; ring: string; wash: string } | null {
  const direct = serviceMeta(slug);
  if (direct) return direct;
  if (!canonical) return null;
  /* `RAIL_LABELS` is the live, complete map — it is the one the category
     directory renders, so the browse page and the directory cannot disagree
     about a category's short name. The local fallback below is a stale copy
     of an older taxonomy and is only consulted for ids the live map does not
     know. */
  const label = RAIL_LABELS[canonical] ?? RAIL_LABEL_FALLBACK[canonical] ?? canonical;
  return {
    title: label,
    // Honest rather than invented: we know the category, not the businesses in
    // it. A made-up sentence here would promise a range that may not exist yet.
    blurb: `Businesses you can order from`,
    ring: "ring-border",
    wash: "from-bg",
  };
}

/** Short display names for canonical ids that have no service slug. */
const RAIL_LABEL_FALLBACK: Record<string, string> = {
  "Clothing & Fashion": "Fashion",
  "Beauty & Personal Care": "Beauty",
  "Electronics & Appliances": "Electronics",
  "Home & Furniture": "Home",
  "Health & Wellness": "Wellness",
  "Agriculture & Farm": "Farm",
  "Pets & Animals": "Pets",
  "Baby & Kids": "Kids",
  "Sports & Outdoors": "Sports",
  "Books & Stationery": "Books",
  "Hardware & Building": "Hardware",
  "Automotive & Fuel": "Fuel",
  "Petrol & Fuel": "Fuel",
  "Events & Tickets": "Tickets",
  "Travel & Hotels": "Travel",
  "Laundry & Cleaning": "Laundry",
  "Repairs & Services": "Repairs",
  "Gifts & Flowers": "Gifts",
  "House Helpers": "Helpers",
};

/**
 * The `/browse/…` path for a canonical category id.
 *
 * Canonical ids are human strings ("Food & Restaurants", "Petrol & Fuel"), so
 * they must never be dropped into a path raw — an unescaped `&` in a path is a
 * query separator. Encoding happens here, once, so a category tile cannot
 * disagree with the browse page about the shape of the URL.
 *
 * `merchantInSlug` above resolves the encoded form back, so every category on the
 * home rail is browsable, not just the three headline services.
 */
export function browseHref(categoryId: string): string {
  return `/browse/${encodeURIComponent(categoryId)}`;
}

export type { CategoryInfo };
