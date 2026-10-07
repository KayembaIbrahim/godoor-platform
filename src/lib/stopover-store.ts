/**
 * Stopover persistence, backed by the `app_settings` key/value table.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The original design stored waiting-time state in a dedicated `ride_stopovers`
 * table plus a dozen `ride_requests.stopover_*` columns. That migration was
 * never applied to the production database, so *none* of it exists there:
 *
 *     ride_requests: 19 of 37 columns  (every stopover_* column absent)
 *     ride_stopovers                 table absent
 *     ride_stopover_disputes         table absent
 *
 * PostgREST rejects a whole statement when it names an unknown column or table,
 * so the feature was not merely hidden — every read and write against those
 * names failed outright. The rider's "waiting on passenger" button could never
 * do anything.
 *
 * `app_settings` does exist in production and is `(key text PRIMARY KEY,
 * value jsonb, updated_at timestamptz)`. Stating the entire stopover record as
 * one JSON value under a per-ride key needs no DDL and, better, gives us a
 * *database-enforced* one-open-clock-per-ride guarantee for free: the lock row's
 * primary key means a concurrent second INSERT returns 23505, exactly like the
 * partial unique index the original schema relied on.
 *
 * If the dedicated tables are ever applied, this module keeps working — it does
 * not assume they are absent, only that it does not require them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StopoverReason } from "@/lib/stopover-core";

const REC_PREFIX = "stopover:";
const LOCK_PREFIX = "stopover:lock:";
const DISPUTE_PREFIX = "stopover:dispute:";

export type StopoverSession = {
  id: string;
  startedAt: string;
  endedAt?: string;
  minutes: number;
  chargeUgx: number;
  reason: StopoverReason;
  closeReason?: "rider" | "auto_movement" | "cap" | "too_short";
  fromLat?: number | null;
  fromLng?: number | null;
  toLat?: number | null;
  toLng?: number | null;
};

export type StopoverDispute = {
  rideId: string;
  reason: string;
  note?: string;
  at: string;
  resolved: boolean;
  waived: boolean;
  resolvedAt?: string;
};

export type StopoverRecord = {
  rideId: string;
  open: { id: string; startedAt: string; reason: StopoverReason; fromLat?: number | null; fromLng?: number | null } | null;
  totalMinutes: number;
  totalChargeUgx: number;
  sessions: StopoverSession[];
  dispute: StopoverDispute | null;
  /** Fare already settled for this trip — a closed ride cannot accrue waits. */
  finalisedAt?: string;
};

export function emptyStopoverRecord(rideId: string): StopoverRecord {
  return {
    rideId,
    open: null,
    totalMinutes: 0,
    totalChargeUgx: 0,
    sessions: [],
    dispute: null,
  };
}

function decode(raw: unknown): StopoverRecord | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StopoverRecord>;
    if (!v || typeof v !== "object" || !Array.isArray(v.sessions)) return null;
    return {
      rideId: String(v.rideId ?? ""),
      open: (v.open ?? null) as StopoverRecord["open"],
      totalMinutes: Number(v.totalMinutes) || 0,
      totalChargeUgx: Number(v.totalChargeUgx) || 0,
      sessions: v.sessions as StopoverSession[],
      dispute: (v.dispute ?? null) as StopoverDispute | null,
      finalisedAt: typeof v.finalisedAt === "string" ? v.finalisedAt : undefined,
    };
  } catch {
    return null;
  }
}

async function readRow(sb: SupabaseClient, key: string): Promise<{ value: string | null } | null> {
  const { data, error } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return { value: (data as { value: string | null }).value };
}

/** The full per-ride record. Missing means "no waiting time on this ride". */
export async function readStopover(sb: SupabaseClient, rideId: string): Promise<StopoverRecord> {
  const row = await readRow(sb, REC_PREFIX + rideId);
  return decode(row?.value) ?? emptyStopoverRecord(rideId);
}

/**
 * Write the record.
 *
 * `resolution=merge-duplicates` makes this an upsert on the primary key, so a
 * record is created on first write and updated thereafter.
 */
export async function writeStopover(sb: SupabaseClient, rec: StopoverRecord): Promise<void> {
  await sb
    .from("app_settings")
    .upsert(
      { key: REC_PREFIX + rec.rideId, value: JSON.stringify(rec), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/* ─── Open-clock lock ───────────────────────────────────────────────────────── */

/**
 * Claim the single open clock for a ride.
 *
 * Returns false when another request already holds it. The guarantee is the
 * primary key on `app_settings.key`, not application logic: two simultaneous
 * inserts for the same key cannot both succeed, so a rider tapping three times
 * at once still produces one clock.
 */
export async function claimStopoverLock(sb: SupabaseClient, rideId: string, sessionId: string): Promise<boolean> {
  const { error } = await sb.from("app_settings").insert({
    key: LOCK_PREFIX + rideId,
    value: JSON.stringify({ sessionId, at: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  });
  return !error;
}

export async function releaseStopoverLock(sb: SupabaseClient, rideId: string): Promise<void> {
  await sb.from("app_settings").delete().eq("key", LOCK_PREFIX + rideId);
}

export async function readStopoverLock(sb: SupabaseClient, rideId: string): Promise<{ sessionId: string; at: string } | null> {
  const row = await readRow(sb, LOCK_PREFIX + rideId);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as { sessionId: string; at: string };
  } catch {
    return null;
  }
}

/* ─── Disputes ──────────────────────────────────────────────────────────────── */

export async function writeDispute(sb: SupabaseClient, d: StopoverDispute): Promise<void> {
  await sb
    .from("app_settings")
    .upsert(
      { key: DISPUTE_PREFIX + d.rideId, value: JSON.stringify(d), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/** All outstanding disputes, for the admin portal. */
export async function listDisputes(sb: SupabaseClient): Promise<StopoverDispute[]> {
  const { data, error } = await sb
    .from("app_settings")
    .select("key, value")
    .like("key", `${DISPUTE_PREFIX}%`);
  if (error || !Array.isArray(data)) return [];
  const out: StopoverDispute[] = [];
  for (const row of data as { key: string; value: string }[]) {
    try {
      const v = JSON.parse(row.value) as StopoverDispute;
      if (v && typeof v === "object" && v.rideId) out.push(v);
    } catch {
      /* Skip a corrupt row rather than failing the whole admin list. */
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Is the stopover subsystem usable at all?
 *
 * Always true on `app_settings`, but we still probe once so a deployment that
 * has genuinely lost the table degrades to a clear "not available" instead of a
 * database error halfway through a money operation.
 */
let READY_AT = 0;
let READY = false;
export async function stopoverStoreReady(sb: SupabaseClient): Promise<boolean> {
  if (READY_AT && Date.now() - READY_AT < 60_000) return READY;
  try {
    const { error } = await sb.from("app_settings").select("key").limit(1);
    READY = !error;
  } catch {
    READY = false;
  }
  READY_AT = Date.now();
  return READY;
}

/** Test seam: forget the cached readiness probe. */
export function resetStopoverStoreProbe(): void {
  READY_AT = 0;
  READY = false;
}
