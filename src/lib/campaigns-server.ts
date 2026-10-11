/**
 * Server-side access to admin-authored flyer campaigns.
 *
 * ── Why `app_settings` and not a table ──────────────────────────────────────
 * FARE_SCHEMA.sql, which would have given campaigns their own table, has never
 * been applied to the production database. Writing a feature against a table
 * that does not exist is exactly how the stopover button ended up invisible and
 * the ride-accept endpoint ended up rejecting every claim. `app_settings` *is*
 * proven present in production (the APK release panel and the fare overrides
 * both read it), so campaigns ship against a store that works on day one, with
 * no migration and no deploy ordering to get wrong.
 *
 * If a dedicated table is ever added, only this file changes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeCampaigns, type Campaign } from "@/lib/campaigns-core";

type ServiceClient = SupabaseClient;

const KEY = "campaigns:v1";

/**
 * Campaigns are read by every page load and written only from the admin
 * portal, so a short memo keeps the home screen off the database without making
 * an edit feel ignored.
 */
let CACHED: { at: number; campaigns: Campaign[] } | null = null;
const TTL_MS = 20_000;

export async function readCampaigns(sb: ServiceClient | null): Promise<Campaign[]> {
  if (!sb) return [];
  if (CACHED && Date.now() - CACHED.at < TTL_MS) return CACHED.campaigns;
  try {
    const { data, error } = await sb.from("app_settings").select("value").eq("key", KEY).maybeSingle();
    if (error) return [];
    let raw: unknown = null;
    if (data) {
      try {
        raw = JSON.parse((data as { value: string }).value);
      } catch {
        // Corrupt value — fall back to no campaigns rather than break the home
        // screen. An admin can re-publish and overwrite it.
        return [];
      }
    }
    const campaigns = sanitizeCampaigns(raw);
    CACHED = { at: Date.now(), campaigns };
    return campaigns;
  } catch {
    return [];
  }
}

export async function writeCampaigns(
  sb: ServiceClient,
  campaigns: Campaign[],
): Promise<{ ok: true; campaigns: Campaign[] } | { ok: false; error: string }> {
  const clean = sanitizeCampaigns(campaigns);
  if (clean.length !== campaigns.length) {
    return { ok: false, error: "One or more campaigns were invalid and nothing was saved" };
  }
  try {
    const { error } = await sb.from("app_settings").upsert(
      { key: KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save campaigns" };
  }
  invalidateCampaigns();
  return { ok: true, campaigns: clean };
}

/** Admin writes must show immediately, not after the TTL. */
export function invalidateCampaigns(): void {
  CACHED = null;
}
