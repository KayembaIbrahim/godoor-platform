import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { serviceFeeFor, type FeeConfigShape } from "@/lib/fees";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1 USD ≈ 4,400 UGX (live rate fallback; API provides the live value). */
export const UGX_PER_USD = 4400;

/** Get the live USD to UGX rate from the fees API. This ensures the client always
 *  uses the same rate the server uses for settlement.
 */
export async function getLiveUgxPerUsd(): Promise<number> {
  try {
    const res = await fetch("/api/fees", { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return Number(body.ugxPerUsd) || UGX_PER_USD;
  } catch {
    return UGX_PER_USD;
  }
}

export function formatUgx(amount: number) {
  return `UGX ${Math.round(amount).toLocaleString("en-UG")}`;
}

/**
 * The delivery fee as it is actually stored on an order.
 *
 * WHY THIS HELPER EXISTS
 * ----------------------
 * The rider dashboard wrote `o.delivery_fee_ugx || 3000` in six places. `||`
 * means "fall back when the value is FALSY" — and 0 is falsy. So a free
 * delivery (a real possibility: the merchant's own fee, or an order over the
 * free-delivery threshold) was stored as 0, shown to the customer as Free,
 * and shown to the rider as 3,000. Same order, two different fares, and the
 * rider is the one who has to drive it.
 *
 * `??` is the correct operator: fall back only when the column is genuinely
 * absent. A stored 0 stays 0.
 */
export function storedDeliveryFee(fee: number | null | undefined): number {
  return typeof fee === "number" && Number.isFinite(fee) ? Math.trunc(fee) : 0;
}

/** Format price with USD equivalent in small text */
export function formatPriceSplit(amount: number, ugxPerUsd?: number): { primary: string; usd: string } {
  const rate = ugxPerUsd ?? UGX_PER_USD;
  const usd = (amount / rate).toFixed(2);
  return { primary: formatUgx(amount), usd: `~$${usd}` };
}

/** GoDoor service fee the customer pays: 15% of the order subtotal.
 *  Delegates to the shared fee model so the quoted total can never drift from
 *  the authoritative server-side amount. Pass the live /api/fees config as the
 *  second argument once it has loaded. */
export function calcServiceFee(subtotalUgx: number, cfg?: FeeConfigShape | null): number {
  return serviceFeeFor(subtotalUgx, cfg);
}


/** Surcharge per kg for heavy/bulky items (e.g. sofas, fridges).
 *  GoDoor charges per kg for heavy deliveries — 1,000 UGX per kg — because
 *  capacity and handling cost scale with weight, not with how many
 *  separate boxes there are. */
export const BULKY_PER_KG_UGX = 1000;

/** Assumed mass of ONE bulky item, used to turn an item count into a weight.
 *
 *  WHY IT LIVES HERE
 *  -----------------
 *  The 10 kg figure was written out as a bare `* 10` in four separate places —
 *  the cart, the checkout, the order route and the quote route. One of them
 *  drifting from the others is exactly how the customer and the rider end up
 *  looking at different numbers, so the figure is defined once, here, and
 *  imported everywhere.
 *
 *  (It is an assumption, not a measurement: the catalogue has no weight field.
 *  When products gain one, this becomes the fallback rather than the rule.) */
export const BULKY_WEIGHT_KG_PER_ITEM = 10;

/** Time-of-day billing tiers (Uganda EAT = UTC+3).
 *  Day (05:00–19:00) min 1,500 · evening (19:00–00:00) min 2,000 · midnight
 *  (00:00–05:00) min 3,000. A 10-minute trip lands near 1,800 day / 2,000
 *  evening / 3,000 midnight instead of a flat ~$1. */
export type FareTier = "day" | "evening" | "midnight";

export function ugandaFareTier(at: Date = new Date()): FareTier {
  const h = (at.getUTCHours() + 3) % 24;
  if (h < 5) return "midnight";
  if (h >= 19) return "evening";
  return "day";
}

export const FARE_MINIMUM_UGX: Record<FareTier, number> = {
  day: 1500,
  evening: 2000,
  midnight: 3000,
};

/** Per-unit rates counted on BOTH road distance and trip time. */
export const FARE_PER_KM_UGX = 200;
export const FARE_PER_MIN_UGX = 100;

/** Calculate GoDoor delivery fee from distance + time with time-of-day minimum.
 *  `durationMin` defaults to a 25 km/h urban motorbike estimate when omitted.
 *  `bulkyWeightKg` adds a per-kg heavy-item surcharge (1,000 UGX/kg) for sofas,
 *  fridges, and other items whose handling cost scales with weight. */
export function calcDeliveryFee(distanceKm: number, bulkyWeightKg = 0, durationMin?: number | null, at?: Date): number {
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const mins = durationMin != null && Number.isFinite(durationMin) && (durationMin as number) > 0
    ? (durationMin as number)
    : (km / 25) * 60;
  const tier = ugandaFareTier(at);
  const raw = FARE_PER_KM_UGX * km + FARE_PER_MIN_UGX * mins;
  let fee = Math.max(FARE_MINIMUM_UGX[tier], raw);
  fee = Math.round(fee / 100) * 100;
  if (bulkyWeightKg > 0) fee += Math.round(bulkyWeightKg) * BULKY_PER_KG_UGX;
  return fee;
}

export function newId(prefix: string) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}

/** Normalize UG phone to 2567XXXXXXXX */
export function normalizeUgPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("256") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `256${digits.slice(1)}`;
  if ((digits.startsWith("7") || digits.startsWith("3")) && digits.length === 9)
    return `256${digits}`;
  return null;
}

export function detectNetwork(msisdn256: string): "mtn_momo" | "airtel_money" | null {
  const local = msisdn256.slice(3);
  if (/^(77|78|76|39)/.test(local)) return "mtn_momo";
  if (/^(70|75|74|20)/.test(local)) return "airtel_money";
  return null;
}

// ─── Phase 1: Commission & Payment Model ──────────────────────────────────────

/** Default platform commission rate charged to the merchant (15%). */
export const DEFAULT_COMMISSION_RATE = 0.15;

/** Generate a unique payment reference like GD-8K2P9 for Morse P2P transfers. */
export function generatePaymentReference(orderId: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `GD-${rand}`;
}

/** Full financial breakdown for an order. All server-computed — client never sets prices. */
export interface OrderFinancials {
  orderId: string;
  subtotalUgx: number;        // sum of item prices × qty (what the customer sees)
  deliveryFeeUgx: number;     // customer-facing delivery fee
  totalCustomerPaysUgx: number; // subtotal + deliveryFee
  commissionRate: number;     // default 0.15
  platformFeeUgx: number;     // subtotal × commissionRate
  merchantPayoutUgx: number;  // subtotal × (1 - commissionRate)
  riderPayoutUgx: number;     // delivery fee portion (or negotiated)
  paymentReference: string;   // unique ref for Morse transfer
}

/** Compute the full financial model for an order. */
export function computeOrderFinancials(params: {
  subtotalUgx: number;
  deliveryFeeUgx: number;
  riderPayoutUgx?: number;
  commissionRate?: number;
  orderId: string;
}): OrderFinancials {
  const { subtotalUgx, deliveryFeeUgx, riderPayoutUgx, commissionRate = DEFAULT_COMMISSION_RATE, orderId } = params;
  const commission = Math.round(subtotalUgx * commissionRate);
  const merchantPayout = subtotalUgx - commission;
  const riderPayout = Number.isFinite(riderPayoutUgx) ? riderPayoutUgx as number : deliveryFeeUgx;
  return {
    orderId,
    subtotalUgx,
    deliveryFeeUgx,
    totalCustomerPaysUgx: subtotalUgx + deliveryFeeUgx,
    commissionRate,
    platformFeeUgx: commission,
    merchantPayoutUgx: merchantPayout,
    riderPayoutUgx: riderPayout,
    paymentReference: generatePaymentReference(orderId),
  };
}

/** Validate that a Morse transfer matches the expected amount and reference. */
export function validateMorseTransfer(params: {
  receivedAmountUgx: number;
  expectedAmountUgx: number;
  reference: string;
  paymentReference: string;
}): { valid: boolean; mismatch?: string } {
  const { receivedAmountUgx, expectedAmountUgx, reference, paymentReference } = params;
  if (reference !== paymentReference) return { valid: false, mismatch: "Reference mismatch" };
  if (receivedAmountUgx < expectedAmountUgx) return { valid: false, mismatch: "Amount short" };
  return { valid: true };
}
