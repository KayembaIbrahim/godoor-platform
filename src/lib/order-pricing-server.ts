/**
 * Server-authoritative order pricing.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The customer was quoted one delivery fee and charged another, and the rider
 * — who reads the stored `orders.delivery_fee_ugx` — was the one who had to
 * drive it. Nothing was broken in isolation. Two different formulas were
 * pricing the same basket:
 *
 *   • The quote endpoint priced from what the BROWSER said: a subtotal the
 *     client sent, a bulky count the client sent.
 *   • The order endpoint priced from what the DATABASE said: line-item prices
 *     read out of `products`, a bulky count derived from the order.
 *
 * Whenever those two disagreed — a stale cart, a price edit, a tampered
 * client — the customer saw the quote and the rider saw the charge.
 *
 * This is the same bug the ride side had, and it was fixed there the same way:
 * `src/lib/pricing-server.ts` gives the quote and the booking one shared
 * `priceRide()`. This file does the same for orders, so the rule holds:
 *
 *   quote = the figure the server will charge
 *   charge = the same function, the same inputs
 *
 * Every input that affects money is resolved from the database HERE: line-item
 * prices from `products`, the fee model from `fee_config`, the distance from
 * the merchant row and the customer's real coordinates, the promo from the live
 * admin table. The client contributes a basket and a promo CODE — never an
 * amount.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcDeliveryFee, BULKY_WEIGHT_KG_PER_ITEM } from "@/lib/utils";
import { resolveFees, serviceFeeFor } from "@/lib/fees";
import { resolvePromoServer } from "@/lib/promo-server";

/** The merchant fields pricing depends on. */
export type PricingMerchant = {
  id: string;
  name?: string | null;
  status?: string | null;
  delivery_fee_ugx?: number | null;
  lat?: number | null;
  lng?: number | null;
};

/** A basket entry as the client sends it. Only the id, quantity and heavy
 *  flag are honoured; the price is always read from the database. */
export type RequestedLineItem = {
  productId?: unknown;
  quantity?: unknown;
  bulky?: unknown;
};

/** A line item with its price resolved against the `products` table. */
export type PricedLineItem = {
  productId: string;
  merchantId: string;
  name: string;
  unitPriceUgx: number;
  quantity: number;
  bulky: boolean;
};

export type PricedOrder = {
  lineItems: PricedLineItem[];
  /** Sum of the resolved line items — never a number the client sent. */
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  /** subtotal + delivery + service, before any discount. */
  grossUgx: number;
  discountUgx: number;
  totalUgx: number;
  distanceKm: number;
  /** Were both ends of the trip locatable? */
  coordsKnown: boolean;
  bulkyCount: number;
  bulkyWeightKg: number;
  freeDelivery: boolean;
  /** The promo as the server resolved it (`ok: false` when unusable). */
  promo: Awaited<ReturnType<typeof resolvePromoServer>>;
};

export type PriceOrderResult =
  | { ok: true; order: PricedOrder }
  | { ok: false; error: string; status: number };

/**
 * Uganda's box — a malformed coordinate must not price a Kampala→Jinja trip.
 *
 * WHY THE EXPLICIT NULL CHECK
 * ---------------------------
 * `Number(null)` is `0`, and `Number("")` is `0` too. A naive range check
 * therefore accepts "no coordinate" as a point in the Gulf of Guinea, which is
 * a real, reachable trap: `merchants.lat` and `merchants.lng` are declared
 * `DEFAULT 0`, and the admin business-approval route inserts new merchants
 * with literally `lat: 0, lng: 0`. Pricing from there turns a 3 km delivery
 * into 3,623 km and the delivery fee into roughly UGX 1,594,200.
 *
 * `null`, `undefined` and `""` are rejected outright so "unknown" stays
 * unknown and the caller falls back to the business's own flat fee.
 */
export function validCoord(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Great-circle distance in kilometres. */
export function haversineKm(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The one function that prices an order.
 *
 * Called by BOTH `POST /api/orders/quote` (what the customer is shown) and
 * `POST /api/orders` (what the customer is charged). They differ only in what
 * they do with the result.
 */
export async function priceOrder(
  sb: SupabaseClient,
  args: {
    merchant: PricingMerchant;
    lineItems: unknown;
    customerLat?: unknown;
    customerLng?: unknown;
    /** A promo CODE, never an amount. */
    promoCode?: unknown;
  },
): Promise<PriceOrderResult> {
  const merchant = args.merchant;
  const merchantId = String(merchant.id ?? "");

  // ── Line items ──────────────────────────────────────────────────────────
  // Only productId, quantity and bulky come from the client. The price is
  // read from `products` for THIS merchant below.
  const requested: Array<{ productId: string; quantity: number; bulky: boolean }> =
    Array.isArray(args.lineItems)
      ? (args.lineItems as RequestedLineItem[]).map((li) => ({
          productId: String(li?.productId ?? ""),
          quantity: Math.max(1, Math.floor(Number(li?.quantity) || 1)),
          bulky: Boolean(li?.bulky),
        }))
      : [];
  const productIds = requested.map((li) => li.productId).filter(Boolean);
  if (productIds.length === 0) {
    return { ok: false, error: "Your cart is empty", status: 400 };
  }

  // Resolve every line item against the products table for this merchant.
  const prices = new Map<string, { price: number; name: string }>();
  for (let i = 0; i < productIds.length; i += 50) {
    const chunk = productIds.slice(i, i + 50);
    const { data: rows } = await sb
      .from("products")
      .select("id, name, price, available")
      .eq("merchant_id", merchantId)
      .in("id", chunk);
    for (const row of rows || []) {
      prices.set(String(row.id), {
        price: Number(row.price ?? 0),
        name: String(row.name || ""),
      });
    }
  }

  const lineItems: PricedLineItem[] = requested.map((li) => {
    const p = prices.get(li.productId);
    return {
      productId: li.productId,
      merchantId,
      name: p ? p.name : "Item",
      unitPriceUgx: p ? p.price : 0,
      quantity: li.quantity,
      bulky: li.bulky,
    };
  });

  let subtotal = 0;
  for (const li of lineItems) subtotal += li.unitPriceUgx * li.quantity;
  if (subtotal <= 0) {
    return { ok: false, error: "Your cart is empty", status: 400 };
  }

  // ── Fee model ───────────────────────────────────────────────────────────
  const { data: feeRow } = await sb
    .from("fee_config")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  const fees = resolveFees(feeRow as Record<string, unknown> | null);

  if (fees.min_order_ugx > 0 && subtotal < fees.min_order_ugx) {
    return {
      ok: false,
      error: `Minimum order is UGX ${fees.min_order_ugx.toLocaleString()}`,
      status: 400,
    };
  }

  // ── Distance ────────────────────────────────────────────────────────────
  const mLat = validCoord(merchant.lat, -1.5, 4.5);
  const mLng = validCoord(merchant.lng, 28, 36);
  const cLat = validCoord(args.customerLat, -1.5, 4.5);
  const cLng = validCoord(args.customerLng, 28, 36);
  const coordsKnown = mLat !== null && mLng !== null && cLat !== null && cLng !== null;
  const distanceKm = coordsKnown
    ? haversineKm(mLat as number, mLng as number, cLat as number, cLng as number)
    : 0;

  // ── Delivery fee ────────────────────────────────────────────────────────
  /* Distance + time billing with day/night minimums (1,500 day · 2,000 from
     7pm · 3,000 midnight) instead of a flat fee. */
  const bulkyCount = lineItems.reduce((s, li) => s + (li.bulky ? li.quantity : 0), 0);
  const bulkyWeightKg = bulkyCount > 0 ? bulkyCount * BULKY_WEIGHT_KG_PER_ITEM : 0;
  const freeDelivery = subtotal >= fees.free_delivery_threshold_ugx;
  const deliveryFee = freeDelivery
    ? 0
    : coordsKnown
      ? calcDeliveryFee(distanceKm, bulkyWeightKg, (distanceKm / 25) * 60)
      : Number(merchant.delivery_fee_ugx ?? fees.delivery_fee_ugx);

  const serviceFee = serviceFeeFor(subtotal, feeRow as Record<string, unknown> | null);
  const grossUgx = subtotal + deliveryFee + serviceFee;

  // ── Promo ───────────────────────────────────────────────────────────────
  /* The client sends a CODE, never an amount. It is looked up against the live
     admin table, so a tampered client can claim a different code but can never
     invent its own discount. */
  const promo = await resolvePromoServer(sb, {
    code: args.promoCode,
    subtotalUgx: subtotal,
    grossUgx,
  });
  const discountUgx = promo.ok ? promo.discountUgx : 0;
  const totalUgx = promo.ok ? promo.totalUgx : grossUgx;

  return {
    ok: true,
    order: {
      lineItems,
      subtotal,
      deliveryFee,
      serviceFee,
      grossUgx,
      discountUgx,
      totalUgx,
      distanceKm,
      coordsKnown,
      bulkyCount,
      bulkyWeightKg,
      freeDelivery,
      promo,
    },
  };
}
