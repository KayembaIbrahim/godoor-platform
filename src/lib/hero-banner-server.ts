/**
 * Server-side storage for the sponsored homepage banner.
 *
 * ── Why `app_settings` ──────────────────────────────────────────────────────
 * A `hero_banners` table would be the natural home, but FARE_SCHEMA.sql has
 * never been applied to the production database, and writing a feature against
 * a table that does not exist is exactly how the stopover button ended up
 * invisible behind a 503 gate. `app_settings` is proven present in production —
 * promos, campaigns, fare overrides and the wallet-security fallback all read
 * and write it — so the banner ships working on day one, with no migration and
 * no deploy ordering to get wrong.
 *
 * If a dedicated table is ever added, only this file changes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeBanner,
  pickBanner,
  type HeroAudience,
  type HeroBanner,
} from "@/lib/hero-banner-core";

type ServiceClient = SupabaseClient;

const KEY = "hero-banner:v1";

/**
 * The banner is read on every home-screen load and written only from the admin
 * portal. A short memo keeps the customer home off the database without making
 * an admin's save feel ignored — which was the trade-off that made promos feel
 * broken when the TTL was too aggressive.
 */
let CACHED: { at: number; banner: HeroBanner | null } | null = null;
const TTL_MS = 20_000;

/** Test seam — lets a suite clear the module singleton between cases. */
export function __resetHeroBannerCache(): void {
  CACHED = null;
}

async function readRaw(sb: ServiceClient | null): Promise<HeroBanner[] | null> {
  if (!sb) return null;
  const { data, error } = await sb.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) return null;
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(String(data.value));
    const arr = Array.isArray(parsed) ? parsed : parsed?.banners;
    return Array.isArray(arr) ? arr : null;
  } catch {
    // A corrupt row must not take the home screen down. Nothing renders.
    return null;
  }
}

/** Every saved slot, newest schedule first. Used by the admin page. */
export async function readBanners(sb: ServiceClient | null): Promise<HeroBanner[]> {
  if (!sb) return [];
  if (CACHED && Date.now() - CACHED.at < TTL_MS && CACHED.banner !== null) {
    // The memo holds the *resolved* banner. Rebuild the list from it so the
    // admin form still has something to edit.
    return [CACHED.banner];
  }
  const raw = await readRaw(sb);
  const list = (raw ?? []).map(normalizeBanner).filter((b): b is HeroBanner => b !== null);
  return list;
}

/**
 * The banner a given audience should see right now, or null.
 *
 * Returns `null` — not a placeholder — when nothing is live, because the home
 * screen must not reserve the space for an ad that is not running.
 */
export async function resolveBanner(
  sb: ServiceClient | null,
  audience: HeroAudience = "all",
): Promise<HeroBanner | null> {
  if (!sb) return null;
  if (CACHED && Date.now() - CACHED.at < TTL_MS) {
    return CACHED.banner && pickBanner([CACHED.banner], Date.now(), audience);
  }
  const raw = await readRaw(sb);
  const picked = pickBanner(raw ?? [], Date.now(), audience);
  CACHED = { at: Date.now(), banner: picked };
  return picked;
}

/**
 * Write the whole slot list.
 *
 * `upsert` on the primary key means this is idempotent: saving the same
 * banner twice produces one row, not a duplicate, so an admin cannot
 * accidentally stack two identical ads in the same slot.
 */
export async function writeBanners(sb: ServiceClient | null, list: unknown[]): Promise<boolean> {
  if (!sb) return false;
  const clean = list.map(normalizeBanner).filter((b): b is HeroBanner => b !== null);
  const { error } = await sb.from("app_settings").upsert(
    { key: KEY, value: JSON.stringify({ banners: clean }), updated_at: Date.now() },
    { onConflict: "key" },
  );
  // Only clear the memo when the write actually succeeded. Clearing it on
  // failure would make the next read hit the database, get the OLD banner
  // back, and then overwrite the admin's edit with it.
  if (!error) CACHED = null;
  return !error;
}