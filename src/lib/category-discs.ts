/**
 * Pastel disc colours for category icons.
 *
 * WHY THESE ARE RGB CHANNELS AND NOT HEX
 * -------------------------------------
 * The discs are painted by `.hybrid-disc` in globals.css, which reads
 * `--disc-rgb` as channel triplets (`249 115 22`) so it can apply its own
 * alpha at three different strengths — tint, border and glyph — from one value.
 * A hex here would force the component to re-declare all three, and they would
 * drift.
 *
 * WHY THE PALETTE IS PICKED FOR CONTRAST, NOT FOR HUE
 * ---------------------------------------------------
 * The same disc treatment is used on the cream page AND on the ink cards, so
 * every value has to stay legible against both. That rules out anything that is
 * only readable on white (pastel yellows) or only on black (deep indigos). The
 * values chosen are mid-tone: dark enough to read as a colour on cream, bright
 * enough to read as a glyph on ink.
 *
 * Deliberately NOT 8 brand hues on the home row. A single row of 20 different
 * pastels reads as confetti rather than as a taxonomy; the point of the disc is
 * to make each icon findable, not to make the screen look like a paint box.
 * The four headline categories get the brand-adjacent colours and the rest share
 * a small slate, so the row stays calm while still being scannable.
 */

/**
 * The eight super-app services the customer home leads with. These are the
 * platform's identity row, so they get brand-adjacent colours rather than the
 * shared slate. Same restraint rule as below: warm for food, green for commerce,
 * blue for wellbeing, purple for money, slate for utilities.
 */
export const SERVICE_DISCS: Record<string, string> = {
  GoFood: "249 115 22", // GoDoor orange — the flagship
  GoRide: "249 115 22", // orange — core vertical, matches the logo
  GoMart: "5 150 105", // trade green
  GoPharma: "37 99 235", // clinical blue
  GoPay: "124 58 237", // violet — money
  GoExpress: "100 116 139", // slate
  Airtime: "100 116 139",
  Services: "100 116 139",
};

/** Channel triplets, grouped so related categories share a hue. */
export const CATEGORY_DISCS: Record<string, string> = {
  // Headline verticals — the ones GoDoor is selling.
  "Food & Restaurants": "249 115 22", // GoDoor orange
  "Groceries & Market": "5 150 105", // trade green
  Pharmacy: "37 99 235", // clinical blue
  "Delivery & Courier": "100 116 139", // slate

  // Everything else shares slate so the rail does not become a rainbow.
  "Clothing & Fashion": "100 116 139",
  "Beauty & Personal Care": "100 116 139",
  "Electronics & Appliances": "100 116 139",
  "Home & Furniture": "100 116 139",
  "Health & Wellness": "5 150 105",
  Agriculture: "84 110 53",
  "Pets & Animals": "100 116 139",
  "Baby & Kids": "100 116 139",
  "Sports & Outdoors": "100 116 139",
  "Books & Stationery": "100 116 139",
  "Automotive & Fuel": "100 116 139",
  "Petrol & Fuel": "100 116 139",
  "Events & Tickets": "100 116 139",
  "Travel & Hotels": "100 116 139",
  "Laundry & Cleaning": "100 116 139",
  "Repairs & Services": "100 116 139",
  "Gifts & Flowers": "100 116 139",
};

/** Fallback for a category added to the taxonomy before it is given a colour. */
export const DEFAULT_DISC = "100 116 139";

export function discRgb(categoryId: string): string {
  return CATEGORY_DISCS[categoryId] ?? DEFAULT_DISC;
}

/** Disc colour for one of the eight super-app services. */
export function serviceDiscRgb(serviceId: string): string {
  return SERVICE_DISCS[serviceId] ?? DEFAULT_DISC;
}