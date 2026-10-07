/**
 * Server-side access to the admin-editable fare rates.
 *
 * Reads the `fare_rates` row (id = 'default') and resolves it to a complete,
 * fully-typed `FareRates`. Every pricing path on the server goes through this so
 * the customer quote, the charge, and the rider's payout are computed from one
 * set of numbers.
 *
 * A missing table or row must never break a booking — it degrades to the
 * compiled-in defaults, which are the values the platform shipped with.
 *
 * ── Why there is a second source ─────────────────────────────────────────────
 * `fare_rates` ships with FARE_SCHEMA.sql, which has never been applied to the
 * production database. Without a fallback that *can* be written, the admin
 * portal's rate controls would silently update a table that does not exist and
 * the platform would keep pricing rides from compiled-in constants forever.
 *
 * `app_settings` does exist in production, so it is the fallback store: rates
 * written there are merged over the defaults. When `fare_rates` is eventually
 * applied it takes precedence automatically, with no code change.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveFareRates, type FareRates } from "@/lib/fare-engine";

type ServiceClient = SupabaseClient;

/** Key/value fallback store. Matches the shape used by the stopover store. */
const RATES_KEY = "fare_rates:default";

/** Cheap per-process memo. Rates change rarely; a booking screen asks often. */
let CACHED: { at: number; rates: FareRates } | null = null;
const TTL_MS = 30_000;

export async function loadFareRates(sb: ServiceClient | null): Promise<FareRates> {
  if (!sb) return resolveFareRates(null);
  if (CACHED && Date.now() - CACHED.at < TTL_MS) return CACHED.rates;
  try {
    /* 1. The dedicated table, when it exists. */
    const { data, error } = await sb.from("fare_rates").select("*").eq("id", "default").maybeSingle();
    if (!error && data) {
      const rates = resolveFareRates((data ?? null) as Record<string, unknown> | null);
      CACHED = { at: Date.now(), rates };
      return rates;
    }
  } catch {
    /* Fall through to the kv store. */
  }
  try {
    /* 2. The always-present key/value override. */
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", RATES_KEY)
      .maybeSingle();
    if (error || !data) return resolveFareRates(null);
    const parsed = JSON.parse((data as { value: string }).value) as Record<string, unknown>;
    const rates = resolveFareRates(parsed);
    CACHED = { at: Date.now(), rates };
    return rates;
  } catch {
    return resolveFareRates(null);
  }
}

/**
 * Persist an admin rate change.
 *
 * Writes the kv override and, when the dedicated table exists, the table row
 * too — so this is correct in both worlds. Returns the rates actually stored so
 * the caller can echo back what is now in force.
 */
export async function saveFareRates(
  sb: ServiceClient,
  patch: Record<string, number>,
): Promise<{ ok: true; rates: FareRates } | { ok: false; error: string }> {
  const next = { ...(resolveFareRates(null) as unknown as Record<string, unknown>), ...patch };
  try {
    const { error } = await sb.from("app_settings").upsert(
      {
        key: RATES_KEY,
        value: JSON.stringify(next),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save rates" };
  }
  /* Mirror into the dedicated table when it is available. */
  try {
    await sb
      .from("fare_rates")
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by: "admin" })
      .eq("id", "default");
  } catch {
    /* Table absent — the kv store is authoritative here. */
  }
  invalidateFareRates();
  return { ok: true, rates: await loadFareRates(sb) };
}

/** Admin writes must be visible immediately, not after the 30 s TTL. */
export function invalidateFareRates(): void {
  CACHED = null;
}