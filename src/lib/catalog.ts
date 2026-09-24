/** Kampala demo catalog — fictional merchants & products in UGX */

export type Category =
  | "food"
  | "groceries"
  | "pharmacy"
  | "packages"
  | "shopping"
  | "documents";

export type Product = {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  priceUgx: number;
  category: string;
};

export type Merchant = {
  id: string;
  name: string;
  category: Category;
  tagline: string;
  area: string;
  lat: number;
  lng: number;
  rating: number;
  etaMin: number;
  etaMax: number;
  deliveryFeeUgx: number;
  isOpen: boolean;
};

export const CATEGORIES: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "food", label: "Food" },
  { id: "groceries", label: "Groceries" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "packages", label: "Packages" },
  { id: "shopping", label: "Shopping" },
  { id: "documents", label: "Documents" },
];

export const MERCHANTS: Merchant[] = [
  {
    id: "mcht_nile",
    name: "Nile Flame Kitchen",
    category: "food",
    tagline: "Luwombo, tilapia, groundnut stew",
    area: "Kololo",
    lat: 0.3261,
    lng: 32.5874,
    rating: 4.8,
    etaMin: 25,
    etaMax: 40,
    deliveryFeeUgx: 3500,
    isOpen: true,
  },
  {
    id: "mcht_grill",
    name: "Kisementi Grill",
    category: "food",
    tagline: "Muchomo & charcoal chicken",
    area: "Kisementi",
    lat: 0.3142,
    lng: 32.5831,
    rating: 4.7,
    etaMin: 20,
    etaMax: 35,
    deliveryFeeUgx: 3000,
    isOpen: true,
  },
  {
    id: "mcht_rolex",
    name: "Wandegeya Rolex Lab",
    category: "food",
    tagline: "Chapati wraps, all day",
    area: "Wandegeya",
    lat: 0.3324,
    lng: 32.5691,
    rating: 4.6,
    etaMin: 15,
    etaMax: 25,
    deliveryFeeUgx: 2500,
    isOpen: true,
  },
  {
    id: "mcht_garden",
    name: "Garden City Grocer",
    category: "groceries",
    tagline: "Produce & pantry, same day",
    area: "Kampala Central",
    lat: 0.3118,
    lng: 32.5839,
    rating: 4.6,
    etaMin: 30,
    etaMax: 50,
    deliveryFeeUgx: 4000,
    isOpen: true,
  },
  {
    id: "mcht_care",
    name: "CarePlus Pharmacy",
    category: "pharmacy",
    tagline: "Licensed · discreet · fast",
    area: "Ntinda",
    lat: 0.3401,
    lng: 32.5962,
    rating: 4.9,
    etaMin: 20,
    etaMax: 35,
    deliveryFeeUgx: 3000,
    isOpen: true,
  },
  {
    id: "mcht_swift",
    name: "SwiftBox Courier",
    category: "packages",
    tagline: "Same-day parcels, OTP on drop",
    area: "Industrial Area",
    lat: 0.3051,
    lng: 32.5991,
    rating: 4.7,
    etaMin: 40,
    etaMax: 90,
    deliveryFeeUgx: 0,
    isOpen: true,
  },
];

export const PRODUCTS: Product[] = [
  { id: "p1", merchantId: "mcht_nile", name: "Chicken Luwombo", description: "Banana leaf, groundnut sauce, matooke", priceUgx: 28000, category: "Mains" },
  { id: "p2", merchantId: "mcht_nile", name: "Charred Nile Tilapia", description: "Whole fish, kachumbari, chips", priceUgx: 36000, category: "Mains" },
  { id: "p3", merchantId: "mcht_nile", name: "Beef Groundnut Stew", description: "Slow beef, posho", priceUgx: 24000, category: "Mains" },
  { id: "p4", merchantId: "mcht_grill", name: "Beef Muchomo Platter", description: "Skewers, gonja, kachumbari", priceUgx: 25000, category: "Grill" },
  { id: "p5", merchantId: "mcht_grill", name: "Quarter Chicken", description: "Charcoal, chips, slaw", priceUgx: 22000, category: "Grill" },
  { id: "p6", merchantId: "mcht_rolex", name: "Classic Rolex", description: "Egg, cabbage, tomato, onion", priceUgx: 5000, category: "Rolex" },
  { id: "p7", merchantId: "mcht_rolex", name: "Beef Rolex", description: "Minced beef, egg, greens", priceUgx: 8000, category: "Rolex" },
  { id: "p8", merchantId: "mcht_garden", name: "Tomato 1kg", description: "Firm, market fresh", priceUgx: 4500, category: "Produce" },
  { id: "p9", merchantId: "mcht_garden", name: "Fresh Milk 1L", description: "Chilled", priceUgx: 3800, category: "Dairy" },
  { id: "p10", merchantId: "mcht_care", name: "Paracetamol 500mg", description: "20 tablets", priceUgx: 4000, category: "OTC" },
  { id: "p11", merchantId: "mcht_care", name: "ORS Sachets (10)", description: "Oral rehydration", priceUgx: 8000, category: "OTC" },
  { id: "p12", merchantId: "mcht_swift", name: "Same-day Envelope", description: "A4 documents, OTP on drop", priceUgx: 8000, category: "Courier" },
  { id: "p13", merchantId: "mcht_swift", name: "Small Parcel (≤5kg)", description: "Citywide", priceUgx: 15000, category: "Courier" },
];

export function getMerchant(id: string) {
  return MERCHANTS.find((m) => m.id === id);
}

export function productsFor(merchantId: string) {
  return PRODUCTS.filter((p) => p.merchantId === merchantId);
}

export function quoteCart(
  items: { productId: string; quantity: number }[],
  merchantId: string,
) {
  const merchant = getMerchant(merchantId);
  if (!merchant) throw new Error("Merchant not found");
  let subtotal = 0;
  const lines: { name: string; quantity: number; unitPriceUgx: number; lineTotal: number }[] = [];
  for (const item of items) {
    const p = PRODUCTS.find((x) => x.id === item.productId && x.merchantId === merchantId);
    if (!p) continue;
    const lineTotal = p.priceUgx * item.quantity;
    subtotal += lineTotal;
    lines.push({ name: p.name, quantity: item.quantity, unitPriceUgx: p.priceUgx, lineTotal });
  }
  const serviceFee = Math.min(6000, Math.max(800, Math.round(subtotal * 0.05)));
  const delivery = merchant.deliveryFeeUgx;
  const total = subtotal + delivery + serviceFee;
  return { merchant, lines, subtotalUgx: subtotal, deliveryFeeUgx: delivery, serviceFeeUgx: serviceFee, totalUgx: total, etaMin: merchant.etaMin, etaMax: merchant.etaMax };
}
