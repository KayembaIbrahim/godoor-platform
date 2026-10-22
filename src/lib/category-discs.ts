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

/**
 * Channel triplets, one per canonical category id.
 *
 * WHY THIS MAP WAS REWRITTEN
 * ---------------------------
 * It used to be written against an EARLIER taxonomy: "Electronics &
 * Appliances", "Home & Furniture", "Health & Wellness", "Agriculture",
 * "Pets & Animals", "Sports & Outdoors", "Automotive & Fuel", "Events &
 * Tickets", "Travel & Hotels", "Laundry & Cleaning", "Repairs & Services",
 * "Gifts & Flowers". None of those ids exist in `CATEGORIES` — the categories
 * were renamed and this map was never updated, so seventeen categories silently
 * fell through to the slate fallback while the map claimed to cover them.
 * A stale key is worse than a missing one: it reads as "already handled".
 *
 * The ids below are now the real canonical ids, so every category gets the
 * colour it was always supposed to have.
 *
 * HUES ARE GROUPED, NOT RANDOM
 * -----------------------------
 * Related verticals share a hue so the grid reads as families rather than
 * confetti: orange for food and cooking, green for fresh and garden, blue for
 * health and care, violet for money and study, rose for beauty and gifts,
 * amber for home and furniture, and slate for the rest. Everything is mid-tone
 * so it stays legible on both the cream page and the ink cards.
 */
export const CATEGORY_DISCS: Record<string, string> = {
  // Headline verticals — the ones GoDoor is selling.
  "Food & Restaurants": "249 115 22", // GoDoor orange
  "Groceries & Market": "5 150 105", // trade green
  Pharmacy: "37 99 235", // clinical blue
  "Delivery & Courier": "100 116 139", // slate

  // Food, cooking and the table.
  "Home & Kitchen": "249 115 22",
  "Hotel & Accommodation": "234 88 12",

  // Fresh produce, garden and the farm.
  "Agriculture & Garden": "84 110 53",

  // Health, care and the body.
  "Beauty & Personal Care": "219 39 119",
  "Salon & Barber": "232 121 249",
  "Baby & Kids": "13 148 136",

  // Things you wear and carry.
  "Clothing & Fashion": "147 51 234",
  "Flowers & Gifts": "225 29 72",

  // Things you plug in and sit at.
  "Electronics & Gadgets": "2 132 199",
  "Computers & Accessories": "71 85 105",
  "Photography & Print": "124 58 237",

  // The home, the workshop and the car.
  "Furniture & Appliances": "180 83 9",
  "Hardware & Building": "120 113 108",
  "Car & Auto Parts": "107 114 128",
  "Petrol & Fuel": "220 38 38",

  // People, books and learning.
  "Education & Tutoring": "79 70 229",
  "Books & Stationery": "67 56 202",

  // Movement, time and events.
  "Transport & Vehicle Hire": "71 85 105",
  "Travel & Tours": "14 116 144",
  "Sports & Fitness": "8 145 178",
  "Events & Hire Services": "234 88 12",
  "Business Services": "100 116 139",

  // The home-help vertical: trusted people sent to your door.
  "House Helpers": "13 148 136",
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