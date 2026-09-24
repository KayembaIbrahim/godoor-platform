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

/** Calculate GoDoor delivery fee based on distance (like Glovo/SafeBoda standard pricing).
 *  Tiered pricing for Uganda market:
 *  - 0–2 km:  UGX 2,500 (base)
 *  - 2–5 km:  UGX 3,500
 *  - 5–10 km: UGX 5,500
 *  - 10–15 km: UGX 8,000
 *  - 15–20 km: UGX 10,500
 *  - 20+ km:  10,500 + 500 per extra km (capped at 25,000)
 *  Heavy/bulky items (flagged on the product by the merchant) add a
 *  per-item surcharge on top, so a sofa is never delivered for the base fee.
 */
export function calcDeliveryFee(distanceKm: number, bulkyItems = 0): number {
  let fee: number;
  if (!isFinite(distanceKm) || distanceKm <= 0) fee = 2500;
  else if (distanceKm <= 2) fee = 2500;
  else if (distanceKm <= 5) fee = 3500;
  else if (distanceKm <= 10) fee = 5500;
  else if (distanceKm <= 15) fee = 8000;
  else if (distanceKm <= 20) fee = 10500;
  else fee = Math.min(25000, 10500 + Math.ceil(distanceKm - 20) * 500);
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
