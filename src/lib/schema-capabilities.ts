import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which columns a PostgREST table actually has, cached per process.
 *
 * WHY THIS EXISTS
 * ---------------
 * PostgREST rejects an ENTIRE statement when any named column is unknown — it
 * does not drop the unknown key and keep going. So a single column that was
 * written by code but never created by a migration silently fails every write
 * that names it.
 *
 * That is not hypothetical. `ride_requests` in production has no
 * `accepted_at`, `started_at` or `completed_at`, so the rider's "Accept"
 * UPDATE was rejected outright by Postgres. The handler then reported the
 * failure as "This ride was already taken" (see rides/route.ts), which sent
 * every rider looking for a competing driver who did not exist.
 *
 * This module lets a write degrade to the columns the database really has
 * instead of failing wholesale. The behaviour is lost only while the migration
 * is outstanding, it is re-probed on a timer, and it lifts automatically the
 * moment an operator applies FARE_SCHEMA.sql — no redeploy.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; cols: Set<string> }>();

/**
 * Did this PostgREST error mean "that column does not exist", as opposed to
 * "the probe itself failed"?
 *
 * `42703` is undefined_column; `42P01` is undefined_table. Both are definitive
 * answers about the schema. A timeout, a 5xx or a permissions error is not —
 * those tell us nothing about which columns exist, and must never be cached as
 * though they did.
 */
function isAbsent(error: { code?: unknown; message?: unknown } | null): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42703" || code === "42P01" || /PGRST204/.test(code)) return true;
  return /does not exist|could not find/i.test(String(error.message ?? ""));
}

/** The subset of `candidates` that `table` really has. */
export async function existingColumns(
  sb: SupabaseClient,
  table: string,
  candidates: readonly string[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const key = `${table}:${[...candidates].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cols;

  const cols = new Set<string>();
  let sawFailure = false;

  /* Fast path: one round trip. Once the migration is applied every candidate
     resolves and we never probe individually. */
  const { error } = await sb.from(table).select(candidates.join(",")).limit(1);
  if (!error) {
    for (const c of candidates) cols.add(c);
  } else if (!isAbsent(error)) {
    sawFailure = true;
  } else {
    /* Degraded path: one unknown column fails the whole select, so each
       candidate has to be asked on its own. This only runs while a schema is
       incomplete, and the answer is cached exactly like the fast path. */
    await Promise.all(
      candidates.map(async (c) => {
        const r = await sb.from(table).select(c).limit(1);
        if (!r.error) cols.add(c);
        else if (!isAbsent(r.error)) sawFailure = true;
      }),
    );
  }

  /* "None of these columns exist" is a real answer and is cached. A probe that
     could not reach a verdict is not: caching that would strip every key from
     every write for the next minute, turning claims into silent no-ops. */
  if (sawFailure) throw new Error(`column probe failed for ${table}`);

  cache.set(key, { at: Date.now(), cols });
  return cols;
}

/**
 * `patch` with any key the table does not have removed.
 *
 * Never silently discard a column the database DOES have — a key is dropped
 * only when PostgREST proved it absent. If the probe cannot be completed at
 * all the patch is returned UNCHANGED: the write then fails loudly with the
 * database's own error, which is strictly better than a filtered-down no-op
 * that reports success while changing nothing.
 */
export async function writableUpdate<T extends Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  patch: T,
): Promise<Partial<T>> {
  let cols: Set<string>;
  try {
    cols = await existingColumns(sb, table, Object.keys(patch));
  } catch (e) {
    console.error(`[schema-capabilities] probe failed for ${table}; writing unfiltered`, e);
    return patch;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (cols.has(k)) out[k] = v;
  if (Object.keys(out).length === 0) {
    console.error(`[schema-capabilities] every column of a ${table} patch was missing; writing unfiltered`);
    return patch;
  }
  return out as Partial<T>;
}

/** Test seam: forget every cached probe. */
export function resetColumnProbe(): void {
  cache.clear();
}
