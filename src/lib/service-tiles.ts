/**
 * The four primary service tiles — Food, Groceries, Pharmacy, Packages.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These tiles used to be defined twice: once as hardcoded JSX on the marketing
 * page (`src/components/home/CategoryRail.tsx`) and once as a different set of
 * chips inside the customer app (`src/app/app/CustomerHome.tsx`). Two
 * definitions of "the four things GoDoor sells" is how the welcome page and the
 * signed-in app ended up looking like different products — and it is how
 * `/browse/packages` came to exist at all.
 *
 * `packages` is NOT a canonical category id, so that tile resolved to nothing
 * and led to an empty browse page. The canonical id for that vertical is
 * "Delivery & Courier". Every tile now links through `browseHref`, which
 * URL-encodes a canonical `CATEGORIES` id that `/browse/[category]` can
 * actually resolve.
 *
 * Adding a fifth vertical means adding one entry here. It appears on the
 * marketing page and in the signed-in app at the same time.
 */

import {
  UtensilsCrossed,
  ShoppingBag,
  Pill,
  Package,
  type LucideIcon,
} from "lucide-react";

export interface ServiceTile {
  /** Canonical `CATEGORIES` id — never a raw string in a URL. */
  category: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  /** Icon colour on the tinted plate. */
  tint: string;
  /** Plate background. */
  plate: string;
  /** Hover border colour on the card. */
  ring: string;
}

export const SERVICE_TILES: readonly ServiceTile[] = [
  {
    category: "Food & Restaurants",
    label: "Food",
    desc: "Meals & restaurants",
    Icon: UtensilsCrossed,
    tint: "text-amber-600 dark:text-amber-400",
    plate: "bg-amber-500/12",
    ring: "hover:border-amber-500/40",
  },
  {
    category: "Groceries & Market",
    label: "Groceries",
    desc: "Market & essentials",
    Icon: ShoppingBag,
    tint: "text-emerald-600 dark:text-emerald-400",
    plate: "bg-emerald-500/12",
    ring: "hover:border-emerald-500/40",
  },
  {
    category: "Pharmacy",
    label: "Pharmacy",
    desc: "Medicine & wellness",
    Icon: Pill,
    tint: "text-blue-600 dark:text-blue-400",
    plate: "bg-blue-500/12",
    ring: "hover:border-blue-500/40",
  },
  {
    // "Delivery & Courier" is the canonical id for the parcel vertical.
    // There is no "packages" category — a tile pointing at that string led to
    // a browse page that could never match a merchant.
    category: "Delivery & Courier",
    label: "Packages",
    desc: "Send anything",
    Icon: Package,
    tint: "text-purple-600 dark:text-purple-400",
    plate: "bg-purple-500/12",
    ring: "hover:border-purple-500/40",
  },
];

/**
 * Categories that lead the customer-home rail, beyond the four primary tiles.
 *
 * WHY A FIXED LIST AND NOT "WHATEVER HAS A SHOP TODAY"
 * ---------------------------------------------------
 * The rail was derived from live merchants alone. GoDoor is early — production
 * had two shops — so the rail rendered two chips that fitted on screen and had
 * nothing to scroll, while the business cards below scrolled normally. The
 * contrast read as a bug, and it was one: a category rail is navigation, not a
 * stock report. A customer deciding where to shop needs to see what the
 * platform offers, not just what happens to be onboard this week.
 *
 * Every id here is a canonical `CATEGORIES` id, so each chip resolves on
 * `/browse/[category]`. A zero-count chip is honest — it lands on the browse
 * page's real empty state, which explains the gap and offers a next action,
 * rather than on a dead link. The order is deliberate: food and daily
 * essentials first, marketplace next, services last.
 */
export const CORE_RAIL_CATEGORIES: readonly string[] = [
  "Clothing & Fashion",
  "Beauty & Personal Care",
  "Home & Kitchen",
  "Electronics & Gadgets",
  "Flowers & Gifts",
  "Furniture & Appliances",
  "Salon & Barber",
  "Car & Auto Parts",
  "Baby & Kids",
  "Sports & Fitness",
  /* Trusted people sent to the door. It sits high because unlike the other
     verticals it is a service people come back for every week, and it is the
     one category a customer looks for when they need someone to clean, cook,
     garden or mind a child. */
  "House Helpers",
];

/**
 * Short labels for rail chips.
 *
 * A canonical id is written for the browse page's heading and read correctly
 * there. In a chip it is far too wide — "Beauty & Personal Care" plus an icon
 * and a count pushes the rail past four chips on a 360px phone, so customers
 * swipe past it without reading. Chips use these instead; the browse page still
 * uses the full canonical name, so the page a chip opens is still unambiguous.
 *
 * Unlisted categories fall back to their canonical id, which is correct but long.
 */
export const RAIL_LABELS: Readonly<Record<string, string>> = {
  "Food & Restaurants": "Food",
  "Groceries & Market": "Groceries",
  "Pharmacy": "Pharmacy",
  "Delivery & Courier": "Packages",
  "Clothing & Fashion": "Fashion",
  "Beauty & Personal Care": "Beauty",
  "Home & Kitchen": "Home",
  "Electronics & Gadgets": "Electronics",
  "Flowers & Gifts": "Flowers",
  "Furniture & Appliances": "Furniture",
  "Salon & Barber": "Salon",
  "Car & Auto Parts": "Auto",
  "Baby & Kids": "Baby",
  "Sports & Fitness": "Sports",
  "Hardware & Building": "Hardware",
  "Books & Stationery": "Books",
  "Photography & Print": "Photos",
  "Travel & Tours": "Travel",
  "Petrol & Fuel": "Fuel",
  "Agriculture & Garden": "Garden",
  "Hotel & Accommodation": "Hotels",
  "Business Services": "Services",
  "Education & Tutoring": "Tutoring",
  "Transport & Vehicle Hire": "Transport",
  "Events & Hire Services": "Events",
  "Computers & Accessories": "Computers",
  "House Helpers": "Helpers",
};