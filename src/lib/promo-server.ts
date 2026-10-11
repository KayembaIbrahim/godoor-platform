/**
 * Server-side access to admin-authored promo codes.
 *
 * ── Why `app_settings` and not a table ──────────────────────────────────────
 * FARE_SCHEMA.sql, which would have given promos their own `promos` table, has
 * never been applied to the production database. Writing a feature against a
 * table that does not exist is exactly how the stopover button ended up
 * invisible and the ride-accept endpoint ended up rejecting every claim.
 * `app_settings` *is* proven present in production (the APK release panel, the
 * fare overrides, campaigns and the wallet-security fallback all read it), so
 * promos ship against a store that works on day one, with no migration and no
 * deploy ordering to get wrong.
 *
 * The order record is the same story: `orders` has no `discount_ugx` or
 * `promo_code` column in production, which this file does not care about — the
 * discount lands in `total_ugx`, which exists. `PROMO_COLUMNS_SQL` below adds
 * the audit columns for whoever can run DDL.
 *
 * If a dedicated table is ever added, only this file changes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mergePromoTable,
  resolvePromo,
  sanitizePromoTable,
  type Promo,
  type PromoAdminEntry,
  type PromoResolution,
} from "@/lib/promo";

type ServiceClient = SupabaseClient;

const KEY = "promos:v1";

/**
 * Promos are read on every order creation and written only from the admin
 * portal, so a short memo keeps checkout off the database without making an
 * admin's edit feel ignored.
 */
let CACHED: { at: number; list: PromoAdminEntry[] | null } | null = null;
const TTL_MS = 20_000;

/**
 * Read the admin-authored promos.
 *
 * Returns `null` — not an empty array — when nothing has been saved yet or the
 * read fails. That distinction matters: `null` means "use the shipped defaults",
 * which is the safe direction. An empty array would silently delete every code
 * the platform has always honoured.
 */
export async function readPromoList(sb: ServiceClient | null): Promise<PromoAdminEntry[] | null> {
  if (!sb) return null;
  if (CACHED && Date.now() - CACHED.at < TTL_MS) return CACHED.list;
  try {
    const { data, error } = await sb.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (error) return null;
    if (!data) {
      CACHED = { at: Date.now(), list: null };
      return null;
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse((data as { value: string }).value);
    } catch {
      // Corrupt value. Falling back to the shipped defaults is the safe
      // direction — it can never invent a discount nobody approved.
      CACHED = { at: Date.now(), list: null };
      return null;
    }
    const list = sanitizePromoTable(raw);
    if (!list) {
      CACHED = { at: Date.now(), list: null };
      return null;
    }
    CACHED = { at: Date.now(), list };
    return list;
  } catch {
    return null;
  }
}

export async function writePromoList(
  sb: ServiceClient,
  list: PromoAdminEntry[],
): Promise<{ ok: true; promos: PromoAdminEntry[] } | { ok: false; error: string }> {
  const clean = sanitizePromoTable(list);
  if (!clean) {
    return { ok: false, error: "One or more promo codes were invalid and nothing was saved" };
  }
  try {
    const { error } = await sb.from("app_settings").upsert(
      { key: KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save promo codes" };
  }
  invalidatePromos();
  return { ok: true, promos: clean };
}

/** Admin writes must show immediately, not after the TTL. */
export function invalidatePromos(): void {
  CACHED = null;
}

/**
 * The table `/api/orders` resolves against: admin entries folded over the
 * shipped defaults.
 */
export async function readPromoTable(sb: ServiceClient | null): Promise<Record<string, Promo>> {
  return mergePromoTable(await readPromoList(sb));
}

/**
 * Resolve a promo against the live table.
 *
 * This is the only function `/api/orders` is allowed to use when deciding what
 * to charge. The client never sends an amount — only a code.
 */
export async function resolvePromoServer(
  sb: ServiceClient | null,
  args: { code: unknown; subtotalUgx: number; grossUgx: number; now?: number },
): Promise<PromoResolution> {
  const table = await readPromoTable(sb);
  return resolvePromo({ ...args, table });
}

/**
 * Record one redemption.
 *
 * Best-effort by design: this is a counter for the admin's "used 12/500" line,
 * and a failed increment must never roll back an order that has already been
 * paid and escrowed. On failure the cached copy is *not* advanced, so the next
 * write reconciles it from the authoritative value.
 */
export async function recordPromoUse(sb: ServiceClient, code: string): Promise<void> {
  try {
    const list = await readPromoList(sb);
    if (!list) return;
    const target = list.find((p) => p.code === code);
    if (!target) return;
    const next = list.map((p) => (p.code === code ? { ...p, uses: (p.uses ?? 0) + 1 } : p));
    const { error } = await sb.from("app_settings").upsert(
      { key: KEY, value: JSON.stringify(next), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (!error) CACHED = { at: Date.now(), list: next };
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }
}

/**
 * Optional audit columns for `orders`.
 *
 * Deliberately NOT applied automatically. The migration needs DDL on the
 * production project, which this workspace's token does not hold, so shipping a
 * dependency on these columns would take order creation down — the exact
 * failure that made every ride unacceptable. Until someone runs this, the
 * discount is still fully charged (it lands in `total_ugx`) and the code is
 * still recorded on the order; it simply is not separately queryable.
 */
export const PROMO_COLUMNS_SQL = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_ugx integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_label text;
`;