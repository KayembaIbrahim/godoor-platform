/**
 * Promo codes — pure resolution logic, safe to import on the server.
 *
 * Why this file exists at all:
 *
 * The promo table used to live inside `customer-stores.ts`, which is a zustand
 * store with `"use client"` semantics. That made it *impossible* for an API
 * route to validate a code, so it didn't. The consequence was a storefront that
 * advertised a discount it never applied: the checkout screen showed
 * "FIRST40 — 40% off" and a reduced total, while `/api/orders` recomputed the
 * total as `subtotal + deliveryFee + serviceFee` and held *that* in escrow. The
 * customer was charged the full price for an order they were told was 40% off.
 *
 * That is not a cosmetic bug. It is a false pricing claim on a live storefront,
 * which in Uganda is a consumer-protection complaint waiting to happen and a
 * payment-processor chargeback already in progress.
 *
 * So the rule is now: **the server owns the discount.** The client sends a code
 * (never a money value), the server looks the code up here, applies it, and
 * holds the discounted amount. A tampered client can claim a different *code*,
 * but it can never invent its own discount, and every code it claims must exist
 * in this table.
 *
 * ── Why the table is an argument ────────────────────────────────────────────
 * An admin can now change a discount, add a code, or switch one off without a
 * deploy, so the table cannot be a frozen module constant. `resolvePromo`
 * therefore takes the table as an argument and defaults to the built-in
 * defaults, which keeps every existing caller (and every test) working while
 * letting `/api/orders` resolve against the live, admin-edited table.
 *
 * Deliberately no React, no zustand, no browser globals — this module is
 * imported by both the client (to render the applied-discount row) and by
 * `/api/orders` (to decide what to actually charge).
 */

export type PromoKind = "percent" | "flat";

export interface Promo {
  /** Stable identifier for the admin list. Absent on the legacy built-ins. */
  id?: string;
  /** Human label for admin surfaces and receipts. */
  label: string;
  discount: number;
  type: PromoKind;
  /** Minimum subtotal in UGX before the code may be used. */
  minSubtotalUgx: number;
  /** Null means it never expires. */
  expiresAt: string | null;
  active: boolean;
  /** 0 means unlimited. */
  maxUses?: number;
  /** Times this code has been honoured. Maintained by the server. */
  uses?: number;
  /**
   * Marks the code the home banner advertises. At most one is featured; the
   * banner reads whichever one this is, so the advertised percentage is by
   * construction the percentage actually charged.
   */
  featured?: boolean;
}

import { FIRST_ORDER_OFFER } from "./first-order-offer";

/**
 * The shipped defaults. These are what the platform runs with before an admin
 * touches anything, and the fallback whenever `app_settings` is unreadable —
 * so a database hiccup degrades to "normal prices", never to "free orders".
 */
export const PROMOS: Record<string, Promo> = {
  GODOOR10: {
    label: "10% off your order",
    discount: 10,
    type: "percent",
    minSubtotalUgx: 0,
    expiresAt: null,
    active: true,
  },
  WELCOME: {
    label: "UGX 5,000 welcome credit",
    discount: 5000,
    type: "flat",
    minSubtotalUgx: 5000,
    expiresAt: null,
    active: true,
  },
  FIRSTORDER: {
    label: "15% off your first order",
    discount: 15,
    type: "percent",
    minSubtotalUgx: 5000,
    expiresAt: null,
    active: true,
  },
  FREEDEL: {
    label: "UGX 2,000 delivery credit",
    discount: 2000,
    type: "flat",
    minSubtotalUgx: 3000,
    expiresAt: null,
    active: true,
  },
  // The advertised first-order offer. Generated from the same constant the home
  // banner renders, so the headline figure and the honoured discount can never
  // drift apart. See src/lib/first-order-offer.ts.
  [FIRST_ORDER_OFFER.code]: {
    label: `${FIRST_ORDER_OFFER.percent}% off your first order`,
    discount: FIRST_ORDER_OFFER.percent,
    type: "percent",
    minSubtotalUgx: 5000,
    expiresAt: null,
    active: true,
    featured: true,
  },
};

/** Code lookup is case-insensitive and trims stray whitespace from mobile keyboards. */
export const normalisePromoCode = (code: unknown): string =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

/**
 * Resolve a code to its discount, or explain why it cannot be used.
 *
 * Returns a discriminated result rather than throwing: the caller needs to tell
 * "no such code" apart from "code exists but the basket is too small", because
 * those are different messages for the customer.
 */
export type PromoResolution =
  | { ok: true; code: string; promo: Promo; discountUgx: number; totalUgx: number }
  | { ok: false; reason: "missing" | "unknown" | "inactive" | "expired" | "min_subtotal" | "max_uses" };

export function resolvePromo(args: {
  code: unknown;
  subtotalUgx: number;
  /** subtotal + delivery + service, i.e. the amount before any discount. */
  grossUgx: number;
  /** Defaults to the built-in table; the server passes the live admin table. */
  table?: Record<string, Promo>;
  now?: number;
}): PromoResolution {
  const { code, subtotalUgx, grossUgx } = args;
  const now = args.now ?? Date.now();
  const table = args.table ?? PROMOS;

  const normalised = normalisePromoCode(code);
  if (!normalised) return { ok: false, reason: "missing" };

  const promo = table[normalised];
  if (!promo) return { ok: false, reason: "unknown" };
  if (!promo.active) return { ok: false, reason: "inactive" };

  if (promo.expiresAt) {
    const expiry = Date.parse(`${promo.expiresAt}T23:59:59Z`);
    if (Number.isFinite(expiry) && now > expiry) return { ok: false, reason: "expired" };
  }

  if (subtotalUgx < promo.minSubtotalUgx) return { ok: false, reason: "min_subtotal" };

  // `maxUses: 0` is the admin's explicit "unlimited", so it must not be read as
  // "already exhausted" — a zero-uses cap would otherwise kill every new code.
  if (promo.maxUses && (promo.uses ?? 0) >= promo.maxUses) {
    return { ok: false, reason: "max_uses" };
  }

  const raw =
    promo.type === "percent"
      ? Math.round((subtotalUgx * promo.discount) / 100)
      : promo.discount;

  // A discount can never exceed the amount being discounted, so a flat credit on
  // a small basket yields a zero total rather than a negative one.
  const discountUgx = Math.min(Math.max(0, raw), grossUgx);

  return {
    ok: true,
    code: normalised,
    promo,
    discountUgx,
    totalUgx: Math.max(0, grossUgx - discountUgx),
  };
}

/** Why a promo cannot be used, in language that belongs on a checkout screen. */
export const PROMO_REASON_TEXT: Record<Exclude<PromoResolution, { ok: true }>["reason"], string> = {
  missing: "Enter a promo code",
  unknown: "That promo code does not exist",
  inactive: "That promo code is no longer active",
  expired: "That promo code has expired",
  min_subtotal: "Your basket is too small for that code",
  max_uses: "That promo code has been fully claimed",
};

/* ── Admin-authored tables ────────────────────────────────────────────────────
 * Everything below validates a table an administrator typed into the portal.
 * The rules exist because these values are money: an unclamped percentage is a
 * 10,000% discount, and a code of "" would shadow a legitimate entry. */

const MAX_PERCENT = 90;
/** No single promo may discount more than this much of any one order. */
const MAX_DISCOUNT_UGX = 500_000;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;

export interface PromoAdminEntry extends Promo {
  id: string;
  code: string;
  discount: number;
  type: PromoKind;
  label: string;
  minSubtotalUgx: number;
  expiresAt: string | null;
  active: boolean;
  maxUses: number;
  uses: number;
  featured: boolean;
}

/**
 * Clamp one admin-entered value into the range money can safely be.
 *
 * NaN and Infinity both survive `Math.min`, so they are rejected explicitly —
 * an `Infinity` discount would otherwise resolve to "pay nothing".
 */
function clampNumber(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Read a discount, refusing it unless it is a usable positive number.
 *
 * Clamping rather than rejecting would be wrong here: `clampNumber(x, 1, 90)`
 * turns a typo of `0` into a real 1% discount, and `-50` into another. An admin
 * who clears the field, or types a minus by accident, would silently start
 * giving money away. A zero or negative discount is refused so the field can be
 * corrected instead.
 */
function readDiscount(raw: unknown, hi: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(hi, Math.round(n));
}

/**
 * Validate an admin-entered promo. Returns `null` rather than throwing so the
 * caller can report *which* field was wrong.
 */
export function sanitizePromo(raw: unknown): PromoAdminEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const code = normalisePromoCode(r.code);
  if (!CODE_RE.test(code)) return null;

  const type: PromoKind = r.type === "flat" ? "flat" : "percent";
  const value = readDiscount(r.discount ?? r.value, type === "percent" ? MAX_PERCENT : MAX_DISCOUNT_UGX);
  if (value <= 0) return null;

  const expiresRaw = typeof r.expiresAt === "string" && r.expiresAt ? r.expiresAt : "";
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? expiresRaw : null;

  const label =
    typeof r.label === "string" && r.label.trim()
      ? r.label.trim().slice(0, 80)
      : type === "percent"
        ? `${value}% off your order`
        : `UGX ${value.toLocaleString()} off your order`;

  return {
    id: typeof r.id === "string" && r.id ? r.id.slice(0, 80) : `pm_${code.toLowerCase()}`,
    code,
    label,
    discount: value,
    type,
    minSubtotalUgx: clampNumber(r.minSubtotalUgx ?? r.minOrder, 0, 10_000_000, 0),
    expiresAt,
    active: r.active !== false,
    // 0 = unlimited, so the floor is 0 rather than 1.
    maxUses: clampNumber(r.maxUses, 0, 1_000_000, 0),
    uses: clampNumber(r.uses, 0, 1_000_000, 0),
    featured: r.featured === true,
  };
}

/**
 * Validate a whole admin table.
 *
 * Returns `null` if anything is wrong, so the caller can reject the entire save
 * — a partial write would leave the portal showing something the database does
 * not contain. Duplicate codes are rejected rather than silently collapsed,
 * because "which of these two wins" is not a question to answer by accident.
 */
export function sanitizePromoTable(raw: unknown): PromoAdminEntry[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > 40) return null;

  const out: PromoAdminEntry[] = [];
  const seen = new Set<string>();
  let featuredCount = 0;

  for (const item of raw) {
    const p = sanitizePromo(item);
    if (!p) return null;
    if (seen.has(p.code)) return null;
    seen.add(p.code);
    // More than one featured code would make the banner ambiguous.
    if (p.featured) featuredCount += 1;
    if (featuredCount > 1) return null;
    out.push(p);
  }
  return out;
}

/** Index a validated table by code for `resolvePromo`. */
export function toPromoTable(list: PromoAdminEntry[]): Record<string, Promo> {
  const table: Record<string, Promo> = {};
  for (const p of list) table[p.code] = p;
  return table;
}

/**
 * Fold admin entries over the built-in defaults.
 *
 * A stored entry with the same code *replaces* the default, so the admin can
 * retune a shipped code (e.g. move FIRST20 from 20% to 25%) without the default
 * silently resurrecting itself. Stored entries never introduce a code the admin
 * did not write.
 *
 * If the saved list features a code, the defaults' `featured` flag is dropped.
 * Otherwise featuring a new code in the portal would leave FIRST20 featured
 * underneath it, and `featuredPromo` — which returns the first match — would
 * keep advertising the old offer.
 */
export function mergePromoTable(list: PromoAdminEntry[] | null): Record<string, Promo> {
  const adminFeatured = !!list?.some((p) => p.featured);
  const merged: Record<string, Promo> = {};
  for (const [code, p] of Object.entries(PROMOS)) {
    merged[code] = adminFeatured && p.featured ? { ...p, featured: false } : p;
  }
  if (!list) return merged;
  for (const p of list) merged[p.code] = { ...merged[p.code], ...p };
  return merged;
}

/**
 * The code the home banner should advertise, falling back to the shipped offer.
 *
 * Returns the CODE alongside the promo because the built-in table is keyed by
 * code and its entries carry no `code` field of their own — returning the promo
 * alone handed callers an object with `.code === undefined`, which is how the
 * banner would have advertised "undefined% off".
 */
export function featuredPromo(
  table: Record<string, Promo>,
): { code: string; promo: Promo } {
  for (const [code, p] of Object.entries(table)) {
    if (p.featured && p.active) return { code, promo: p };
  }
  const code = FIRST_ORDER_OFFER.code;
  return { code, promo: table[code] ?? PROMOS[code] };
}