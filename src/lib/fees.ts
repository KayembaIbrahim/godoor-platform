/**
 * Shared fee model — single source of truth for server and client.
 *
 * The server is authoritative (it recomputes every amount from fee_config and
 * line items). The cart and checkout used to hardcode 5% independently, which
 * is how the displayed total drifted away from the charged total. Both now
 * resolve through the same helpers, and the client reads the live config from
 * /api/fees.
 *
 * All amounts are integer UGX. No floating-point money math beyond the
 * percent division, which is rounded half-up exactly once.
 */

export const FALLBACK_FEE_CONFIG = {
  id: "default",
  delivery_fee_ugx: 2000,
  service_fee_percent: 15,
  service_fee_min_ugx: 0,
  /** Guard rail only — must stay well above 15% of any realistic basket so it
   *  never silently undercharges a large order. */
  service_fee_max_ugx: 1_000_000,
  min_order_ugx: 3000,
  free_delivery_threshold_ugx: 25000,
  rider_commission_percent: 95,
  platform_commission_percent: 5,
} as const;

export type FeeConfigShape = {
  id?: string;
  delivery_fee_ugx?: number | null;
  service_fee_percent?: number | null;
  service_fee_min_ugx?: number | null;
  service_fee_max_ugx?: number | null;
  min_order_ugx?: number | null;
  free_delivery_threshold_ugx?: number | null;
  rider_commission_percent?: number | null;
  platform_commission_percent?: number | null;
  /** Live USD→UGX (live-rate.ts). Optional — null while loading. */
  ugx_per_usd?: number | null;
  rateSource?: "live" | "cached" | "fallback" | "loading";
  rateUpdatedAt?: string | null;
  rateStale?: boolean;
};

/**
 * Flat service fees — business-pricing model, researched against SafeBoda/Glovo
 * Uganda benchmarks (2024-2025).
 *
 * Research notes:
 * - SafeBoda Uganda: base fare ~500 UGX + per-km/min pricing; minimum ride
 *   ~1,000–2,000 UGX for short trips; competitive with boda stages.
 * - Glovo Uganda: flat service fee UGX 400 per order (kept constant as distance
 *   rises), delivery fee scales with distance; merchant commission 25–35% on
 *   the order value (not the delivery fee).
 *
 * GoDoor policy (flat, predictable — no percentage on the customer):
 * - GoRide (boda/car): UGX 250 fixed platform fee.
 * - Shopping (GoMart/Pharma/etc. orders): UGX 500 fixed platform fee.
 * - GoMart shopping-list runner: UGX 3,000 fixed fee + UGX 3,000 extra-stop
 *   surcharge when items must be sourced beyond a single shop (rider must
 *   travel to a second location). Rider earns 65% of the 3,000 fee
 *   (UGX 1,950); platform keeps 35% (UGX 1,050).
 */
export const FLAT_SERVICE_FEE_RIDE_UGX = 250;
export const FLAT_SERVICE_FEE_SHOPPING_UGX = 500;
export const SHOPPING_LIST_RUNNER_FEE_UGX = 3000;
export const SHOPPING_LIST_EXTRA_STOP_SURCHARGE_UGX = 3000;
export const SHOPPING_LIST_RIDER_SHARE_PERCENT = 65;
export const SHOPPING_LIST_FEE_GROCERY_ONLY_UGX = 3000;
export const SHOPPING_LIST_FEE_NON_GROCERY_UGX = 6000;

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Fully-populated fee config: every field is a real number, never null. */
export type ResolvedFees = ReturnType<typeof resolveFees>;

export function resolveFees(row?: FeeConfigShape | null) {
  const f = FALLBACK_FEE_CONFIG;
  const rider = Math.trunc(num(row?.rider_commission_percent, f.rider_commission_percent));
  return {
    delivery_fee_ugx: Math.trunc(num(row?.delivery_fee_ugx, f.delivery_fee_ugx)),
    service_fee_percent: num(row?.service_fee_percent, f.service_fee_percent),
    service_fee_min_ugx: Math.trunc(num(row?.service_fee_min_ugx, f.service_fee_min_ugx)),
    service_fee_max_ugx: Math.trunc(num(row?.service_fee_max_ugx, f.service_fee_max_ugx)),
    min_order_ugx: Math.trunc(num(row?.min_order_ugx, f.min_order_ugx)),
    free_delivery_threshold_ugx: Math.trunc(
      num(row?.free_delivery_threshold_ugx, f.free_delivery_threshold_ugx),
    ),
    rider_commission_percent: rider,
    platform_commission_percent: Math.trunc(num(row?.platform_commission_percent, 100 - rider)),
  };
}

/**
 * Customer service fee. Half-up rounding, then clamp to the configured
 * floor/ceiling. `percent` defaults to 15 so a caller can never accidentally
 * quote the old 5%.
 */
/**
 * Flat service fee by service kind. Replaces the old percent-of-subtotal model
 * (which could charge UGX 1,500 on a small order but UGX 15,000 on a big one
 * for the same effort). Predictable for customers, fair for riders.
 */
export type ServiceFeeKind = "ride_boda" | "ride_car" | "shopping" | "pharmacy" | "general";

export function serviceFeeFor(
  subtotalUgx: number,
  cfg?: FeeConfigShape | null,
  kind?: ServiceFeeKind,
): number {
  if (!Number.isFinite(subtotalUgx) || subtotalUgx <= 0) return 0;
  switch (kind) {
    case "ride_boda":
    case "ride_car":
      return FLAT_SERVICE_FEE_RIDE_UGX;
    case "pharmacy":
      return 1000;
    case "shopping":
      return FLAT_SERVICE_FEE_SHOPPING_UGX;
    default:
      return FLAT_SERVICE_FEE_SHOPPING_UGX;
  }
}

/**
 * GoMart runner fee: flat 3,000 when grocery-only (single shop), 6,000 when
 * the list needs sourcing beyond one location (extra stop). Rider earns 65%.
 */
export function shoppingListRunnerFee(needsExtraStop: boolean): number {
  return needsExtraStop
    ? SHOPPING_LIST_FEE_NON_GROCERY_UGX
    : SHOPPING_LIST_FEE_GROCERY_ONLY_UGX;
}

export function shoppingListRiderShare(feeUgx: number): number {
  return Math.round((feeUgx * SHOPPING_LIST_RIDER_SHARE_PERCENT) / 100);
}

export const BUSINESS_FEE_PERCENT = 15;
export const RIDER_FEE_PERCENT = 15;
export const CUSTOMER_SERVICE_FEE_PERCENT = 0; // deprecated: flat fees only

/** Integer split used at settlement, mirroring release_escrow in SQL. */
export function splitOrderAmounts(subtotalUgx: number, deliveryFeeUgx: number) {
  const sub = Math.max(0, Math.trunc(subtotalUgx) || 0);
  const del = Math.max(0, Math.trunc(deliveryFeeUgx) || 0);
  const customerFee = serviceFeeFor(sub, null, "shopping");
  const businessFee = Math.round((sub * BUSINESS_FEE_PERCENT) / 100);
  const riderFee = Math.round((del * RIDER_FEE_PERCENT) / 100);
  return {
    customerFee,
    businessFee,
    riderFee,
    merchantPayout: Math.max(sub - businessFee, 0),
    riderPayout: Math.max(del - riderFee, 0),
  };
}

type FeeColumns = {
  customer_fee_ugx?: number | null;
  business_fee_ugx?: number | null;
  rider_fee_ugx?: number | null;
  merchant_payout_ugx?: number | null;
  rider_payout_ugx?: number | null;
  // legacy pre-escrow column names
  customer_service_fee_ugx?: number | null;
  business_service_fee_ugx?: number | null;
  rider_service_fee_ugx?: number | null;
  platform_fees_ugx?: number | null;
};

const firstSet = (...vals: Array<number | null | undefined>): number => {
  for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
};

/**
 * Read the settled split off an order row, falling back to the legacy
 * `*_service_fee_ugx` columns so orders settled before the escrow rollout
 * still report a fee instead of silently showing zero.
 */
export function orderFees(o: FeeColumns | null | undefined) {
  return {
    customerFee: firstSet(o?.customer_fee_ugx, o?.customer_service_fee_ugx),
    businessFee: firstSet(o?.business_fee_ugx, o?.business_service_fee_ugx),
    riderFee: firstSet(o?.rider_fee_ugx, o?.rider_service_fee_ugx),
    merchantPayout: firstSet(o?.merchant_payout_ugx),
    riderPayout: firstSet(o?.rider_payout_ugx),
    platformFees: firstSet(
      o?.customer_fee_ugx,
      o?.business_fee_ugx,
      o?.rider_fee_ugx,
      o?.platform_fees_ugx,
    ) || (
      firstSet(o?.customer_fee_ugx, o?.customer_service_fee_ugx) +
      firstSet(o?.business_fee_ugx, o?.business_service_fee_ugx) +
      firstSet(o?.rider_fee_ugx, o?.rider_service_fee_ugx)
    ),
  };
}
