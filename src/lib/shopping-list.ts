/**
 * Shopping List — shared types + pricing rules.
 *
 * NOTE: this module is intentionally free of JSX so it can be imported from
 * both server routes (`src/app/api/shopping-list/route.ts`) and client
 * components without pulling React into the server bundle.
 *
 * Business rules (product requirement):
 *   • A shopping list must contain AT LEAST 5 valid items.
 *   • Each valid item is charged a shopping service fee of UGX 500.
 *   • 5 items  => 2,500 UGX shopping fee
 *   • 10 items => 5,000 UGX shopping fee
 *   • Merchandise cost and delivery fee are calculated SEPARATELY and are
 *     never folded into the shopping fee.
 *   • All totals are recomputed on the server. Client-supplied totals are
 *     never trusted.
 */

export const SHOPPING_FEE_PER_ITEM_UGX = 500;
export const SHOPPING_LIST_MIN_ITEMS = 5;
export const SHOPPING_LIST_MAX_ITEMS = 100;
export const SHOPPING_ITEM_MAX_QUANTITY = 99;
export const SHOPPING_ITEM_NAME_MAX = 120;
export const SHOPPING_ITEM_NOTE_MAX = 240;

/** A single line on a customer's shopping list. */
export interface ShoppingItem {
  /** Stable client-generated id (used for optimistic UI + dedupe). */
  id?: string;
  /** Product id when the customer picked a catalogue product. */
  productId?: string | null;
  /** Merchant the item should be sourced from (optional). */
  merchantId?: string | null;
  /** Human readable item name — required. */
  name: string;
  /** Quantity of the item — required, >= 1. */
  quantity: number;
  /** Optional preference, e.g. "ripe", "brand: Airtel". */
  preference?: string | null;
  /** Optional shopper instruction, e.g. "buy any brand". */
  instructions?: string | null;
  /** Optional price per unit the customer saw in the catalogue (UGX). */
  unitPriceUgx?: number | null;
}

/** A persisted shopping list. */
export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
  /** Shopping service fee (UGX) = valid item count * 500. */
  shoppingFeeUgx: number;
  /** Sum of confirmed merchandise prices (UGX), 0 until confirmed by staff. */
  merchandiseUgx: number;
  /** Delivery fee (UGX), 0 until a quote is issued. */
  deliveryFeeUgx: number;
  /** Grand total (UGX) = shopping fee + merchandise + delivery. */
  totalUgx: number;
  status: ShoppingListStatus;
  createdAt: string;
  updatedAt: string;
}

export type ShoppingListStatus =
  | "draft"
  | "submitted"
  | "shopping"
  | "awaiting_approval"
  | "confirmed"
  | "assigned"
  | "delivering"
  | "delivered"
  | "cancelled";

/** Per-item validation result. */
export interface ItemValidation {
  index: number;
  valid: boolean;
  reason?: string;
  item?: ShoppingItem;
}

/** Result of validating a whole list on the server. */
export interface ShoppingListValidation {
  valid: boolean;
  items: ItemValidation[];
  validItemCount: number;
  shoppingFeeUgx: number;
  merchandiseUgx: number;
  deliveryFeeUgx: number;
  totalUgx: number;
  errors: string[];
}

function cleanString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function toInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * Validate a single raw item coming from an untrusted client.
 * Returns a normalised item when valid.
 */
export function validateShoppingItem(
  raw: unknown,
  index: number,
): ItemValidation {
  if (!raw || typeof raw !== "object") {
    return { index, valid: false, reason: `Item ${index + 1} is not valid.` };
  }

  const r = raw as Record<string, unknown>;
  const name = cleanString(r.name);
  if (!name) {
    return { index, valid: false, reason: `Item ${index + 1} is missing a name.` };
  }
  if (name.length > SHOPPING_ITEM_NAME_MAX) {
    return {
      index,
      valid: false,
      reason: `Item ${index + 1} name must be ${SHOPPING_ITEM_NAME_MAX} characters or fewer.`,
    };
  }

  const quantity = toInt(r.quantity, 0);
  if (quantity < 1) {
    return {
      index,
      valid: false,
      reason: `Item "${name}" must have a quantity of at least 1.`,
    };
  }
  if (quantity > SHOPPING_ITEM_MAX_QUANTITY) {
    return {
      index,
      valid: false,
      reason: `Item "${name}" quantity must be ${SHOPPING_ITEM_MAX_QUANTITY} or fewer.`,
    };
  }

  const preference = cleanString(r.preference) || null;
  const instructions = cleanString(r.instructions) || null;

  if (preference && preference.length > SHOPPING_ITEM_NAME_MAX) {
    return {
      index,
      valid: false,
      reason: `Item "${name}" preference is too long.`,
    };
  }
  if (instructions && instructions.length > SHOPPING_ITEM_NOTE_MAX) {
    return {
      index,
      valid: false,
      reason: `Item "${name}" instructions are too long.`,
    };
  }

  const unitPriceRaw = r.unitPriceUgx;
  const unitPriceUgx =
    unitPriceRaw === null || unitPriceRaw === undefined
      ? null
      : Math.max(0, toInt(unitPriceRaw, 0));

  const productId = cleanString(r.productId) || null;
  const merchantId = cleanString(r.merchantId) || null;
  const id = cleanString(r.id) || null;

  return {
    index,
    valid: true,
    item: {
      id: id ?? undefined,
      productId,
      merchantId,
      name,
      quantity,
      preference,
      instructions,
      unitPriceUgx,
    },
  };
}

/**
 * Validate an entire submitted list and compute authoritative totals.
 * The shopping fee is derived from the number of VALID items only.
 */
export function validateShoppingList(
  rawItems: unknown,
  opts?: { deliveryFeeUgx?: number },
): ShoppingListValidation {
  const errors: string[] = [];

  if (!Array.isArray(rawItems)) {
    return {
      valid: false,
      items: [],
      validItemCount: 0,
      shoppingFeeUgx: 0,
      merchandiseUgx: 0,
      deliveryFeeUgx: 0,
      totalUgx: 0,
      errors: ["Shopping list must be an array of items."],
    };
  }

  if (rawItems.length > SHOPPING_LIST_MAX_ITEMS) {
    errors.push(
      `A shopping list can contain at most ${SHOPPING_LIST_MAX_ITEMS} items.`,
    );
  }

  const results = rawItems.map((raw, i) => validateShoppingItem(raw, i));
  const validItems = results.filter((r) => r.valid && r.item).map((r) => r.item!);

  for (const r of results) {
    if (!r.valid && r.reason) errors.push(r.reason);
  }

  const validItemCount = validItems.length;

  if (validItemCount < SHOPPING_LIST_MIN_ITEMS) {
    errors.push(
      `Shopping list must contain at least ${SHOPPING_LIST_MIN_ITEMS} valid items. You added ${validItemCount}.`,
    );
  }

  const shoppingFeeUgx = validItemCount * SHOPPING_FEE_PER_ITEM_UGX;

  // Merchandise is only counted from client-supplied unit prices as an
  // ESTIMATE. The authoritative merchandise cost is set by staff when the
  // list is shopped (see /api/shopping-list PATCH -> confirm).
  const merchandiseUgx = validItems.reduce(
    (sum, item) => sum + (item.unitPriceUgx ?? 0) * item.quantity,
    0,
  );

  const deliveryFeeUgx = Math.max(0, toInt(opts?.deliveryFeeUgx ?? 0, 0));
  const totalUgx = shoppingFeeUgx + merchandiseUgx + deliveryFeeUgx;

  return {
    valid: errors.length === 0,
    items: results,
    validItemCount,
    shoppingFeeUgx,
    merchandiseUgx,
    deliveryFeeUgx,
    totalUgx,
    errors,
  };
}

/** Format a UGX amount for display (no decimals — UGX has no minor unit). */
export function formatUgx(amount: number): string {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  return n.toLocaleString("en-UG", { maximumFractionDigits: 0 });
}
