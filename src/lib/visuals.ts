import {
  Armchair,
  Beef,
  Coffee,
  Croissant,
  FileText,
  Flame,
  Package,
  Pill,
  ShoppingBag,
  ShoppingBasket,
  Stethoscope,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Merchant } from "@/lib/catalog";

/**
 * Category artwork.
 *
 * `merchants.category` is a free-text column, not an enum — real rows carry
 * values like `"Food & Restaurants"` and `"Furniture "` (note the trailing
 * space). Matching on equality therefore misses almost every row and drops all
 * of them onto one grey fallback icon. These rules match on substrings
 * instead, first match wins, so an unlisted-but-describable category still
 * lands on something sensible.
 *
 * `bg`/`text` are the same soft-tint pairs the app already uses, so the artwork
 * sits inside the existing theme rather than introducing new colours.
 */
export type CategoryVisual = {
  icon: LucideIcon;
  bg: string;
  text: string;
};

const FOOD: CategoryVisual = { icon: UtensilsCrossed, bg: "bg-amber-500/20", text: "text-amber-500" };
const PHARMACY: CategoryVisual = { icon: Pill, bg: "bg-blue-500/20", text: "text-blue-500" };
const GROCERY: CategoryVisual = { icon: ShoppingBasket, bg: "bg-emerald-500/20", text: "text-emerald-500" };
const FURNITURE: CategoryVisual = { icon: Armchair, bg: "bg-teal-500/20", text: "text-teal-500" };
const PACKAGES: CategoryVisual = { icon: Package, bg: "bg-orange-500/20", text: "text-orange-500" };
const DOCUMENTS: CategoryVisual = { icon: FileText, bg: "bg-slate-500/20", text: "text-slate-500" };
const SHOPPING: CategoryVisual = { icon: ShoppingBag, bg: "bg-purple-500/20", text: "text-purple-500" };

export const FALLBACK_CATEGORY: CategoryVisual = {
  icon: Store,
  bg: "bg-gray-500/20",
  text: "text-gray-500",
};

/** Ordered — the first rule whose keyword appears in the label wins. */
const CATEGORY_RULES: { keys: string[]; visual: CategoryVisual }[] = [
  { keys: ["pharm", "drug", "medic", "clinic", "hospital", "health", "dental"], visual: PHARMACY },
  { keys: ["grocer", "supermarket", "market", "provision", "produce", "bakery"], visual: GROCERY },
  { keys: ["furniture", "furnishing", "home decor", "mattress", "sofa", "appliance", "electronics"], visual: FURNITURE },
  { keys: ["document", "envelope", "printing", "stationery", "lumber"], visual: DOCUMENTS },
  { keys: ["package", "parcel", "courier", "delivery", "shipping", "errand", "logistic"], visual: PACKAGES },
  { keys: ["restaurant", "food", "cafe", "coffee", "kitchen", "pizza", "eatery", "grill", "chapati", "fast food"], visual: FOOD },
  { keys: ["boutique", "fashion", "cloth", "wear", "apparel", "shop", "store", "retail"], visual: SHOPPING },
];

/** Resolve a free-text category label to themed artwork. */
export function categoryVisual(category?: string | null): CategoryVisual {
  const label = (category ?? "").trim().toLowerCase();
  if (!label) return FALLBACK_CATEGORY;
  for (const rule of CATEGORY_RULES) {
    if (rule.keys.some((k) => label.includes(k))) return rule.visual;
  }
  return FALLBACK_CATEGORY;
}

/** Per-merchant override for the two demo rows that read better as food art. */
function merchantIconOverride(m: Merchant): LucideIcon | null {
  if (m.id === "mcht_grill") return Flame;
  if (m.id === "mcht_rolex") return Beef;
  return null;
}

/** Themed icon + accent pair for one merchant row. */
export function merchantVisual(m: Merchant) {
  const visual = categoryVisual(m.category);
  return {
    icon: merchantIconOverride(m) ?? visual.icon,
    tint: `from-go/20 to-go/5`,
    ring: "ring-go/30",
    bg: visual.bg,
    text: visual.text,
  };
}

export { Stethoscope, Coffee, Croissant };