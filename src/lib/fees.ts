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
};

/** Percent of the order subtotal retained by GoDoor from the customer (15%). */
export const CUSTOMER_SERVICE_FEE_PERCENT = 15;
/** Deducted from the merchant's subtotal (10%). */
export const BUSINESS_FEE_PERCENT = 10;
/** Deducted from the rider's delivery fee (5%). */
export const RIDER_FEE_PERCENT = 5;

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
export function serviceFeeFor(
  subtotalUgx: number,
  cfg?: FeeConfigShape | null,
  percent?: number,
): number {
  if (!Number.isFinite(subtotalUgx) || subtotalUgx <= 0) return 0;
  const fees = resolveFees(cfg);
  const pct = Number.isFinite(percent as number)
    ? (percent as number)
    : Number.isFinite(fees.service_fee_percent)
      ? fees.service_fee_percent
      : CUSTOMER_SERVICE_FEE_PERCENT;
  const raw = Math.round((subtotalUgx * pct) / 100);
  return Math.min(fees.service_fee_max_ugx, Math.max(fees.service_fee_min_ugx, raw));
}

/** Integer split used at settlement, mirroring release_escrow in SQL. */
export function splitOrderAmounts(subtotalUgx: number, deliveryFeeUgx: number) {
  const sub = Math.max(0, Math.trunc(subtotalUgx) || 0);
  const del = Math.max(0, Math.trunc(deliveryFeeUgx) || 0);
  const customerFee = serviceFeeFor(sub);
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
