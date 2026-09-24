import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1 USD ≈ 3,750 UGX */
const UGX_PER_USD = 3750;

export function formatUgx(amount: number) {
  return `UGX ${Math.round(amount).toLocaleString("en-UG")}`;
}

/** Format price with USD equivalent in small text */
export function formatPriceSplit(amount: number): { primary: string; usd: string } {
  const usd = (amount / UGX_PER_USD).toFixed(2);
  return { primary: formatUgx(amount), usd: `~$${usd}` };
}

/** Calculate GoDoor service fee: flat 5% on every order's subtotal. */
export function calcServiceFee(subtotalUgx: number): number {
  if (subtotalUgx <= 0) return 0;
  return Math.round(subtotalUgx * 0.05);
}


/** Surcharge per heavy/bulky item (e.g. sofas, fridges). Distance is a poor
 *  proxy for these — the extra handling/capacity cost is priced per item. */
export const BULKY_ITEM_SURCHARGE_UGX = 5000;

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
 *  Heavy/bulky items add a per-item surcharge on top.
 */
export function calcDeliveryFee(distanceKm: number, bulkyItems = 0, durationMin?: number | null, at?: Date): number {
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const mins = durationMin != null && Number.isFinite(durationMin) && (durationMin as number) > 0
    ? (durationMin as number)
    : (km / 25) * 60;
  const tier = ugandaFareTier(at);
  const raw = FARE_PER_KM_UGX * km + FARE_PER_MIN_UGX * mins;
  let fee = Math.max(FARE_MINIMUM_UGX[tier], raw);
  fee = Math.round(fee / 100) * 100;
  if (bulkyItems > 0) fee += bulkyItems * BULKY_ITEM_SURCHARGE_UGX;
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
