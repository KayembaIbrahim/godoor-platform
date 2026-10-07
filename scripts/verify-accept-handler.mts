/**
 * End-to-end test of the real rider "accept" write path, in-process, against a
 * PostgREST-faithful fake seeded with production's ACTUAL column set.
 *
 * WHY A FAKE AND NOT PRODUCTION
 * -----------------------------
 * Proving this against production would mean extracting the service-role key
 * and writing a fake verified rider into a database that is about to onboard
 * real users. The evidence does not justify that risk. Instead this exercises
 * the real `writableUpdate` and a fake that reproduces the exact rule that
 * caused the bug: PostgREST rejects an ENTIRE update when ANY named column is
 * unknown. The missing-column set is the one read from llzq… at the time of
 * writing, not invented.
 *
 * FAITHFULNESS CONTRACT (an earlier version of this fake got both wrong)
 * ----------------------------------------------------------------------
 * 1. supabase-js NEVER throws for a query error. It resolves to
 *    `{ data: null, error: { code: "42703" } }`. A fake that throws makes
 *    correct code look broken — it did.
 * 2. Every builder is chainable: `.eq().eq().select().maybeSingle()`.
 */

import { writableUpdate, resetColumnProbe } from "../src/lib/schema-capabilities.ts";

/* Columns read from production `ride_requests` (llzqkduccdbbetevpoql). */
const PROD_COLUMNS = new Set([
  "id", "status", "customer_id", "customer_name", "customer_phone",
  "rider_id", "rider_name", "pickup_lat", "pickup_lng", "pickup_address",
  "dropoff_lat", "dropoff_lng", "dropoff_address", "distance_km",
  "fare_ugx", "service_fee_ugx", "total_ugx", "created_at", "updated_at",
]);

const TABLE = "ride_requests";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "requested",
  customer_id: "22222222-2222-2222-2222-222222222222",
  rider_id: null,
  rider_name: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

type Result = { data: unknown; error: unknown };

/** Models PostgREST: an unknown column fails the WHOLE statement (42703),
 *  and the failure arrives as an `error` object, never as a throw. */
function makeDb(existing: Record<string, unknown>, columns: Set<string>) {
  const state = { row: { ...existing } };

  const undefinedCol = (col: string) =>
    Object.assign(new Error(`column ${TABLE}.${col} does not exist`), { code: "42703" });

  const unknownIn = (names: readonly string[]) =>
    names.map((n) => n.trim()).filter((n) => n && !columns.has(n));

  function selectResult(cols: string[] | undefined, filters: Record<string, unknown>): Result {
    const bad = [...unknownIn(cols ?? []), ...Object.keys(filters).filter((k) => !columns.has(k))];
    if (bad.length) return { data: null, error: { code: "42703", message: undefinedCol(bad[0]).message } };
    return { data: [state.row], error: null };
  }

  const sb = {
    from(table: string) {
      if (table !== TABLE) throw new Error(`unexpected table ${table}`);
      return {
        select(cols?: string) {
          const filters: Record<string, unknown> = {};
          const list = cols ? cols.split(",") : undefined;
          const b: Record<string, unknown> = {
            eq(k: string, v: unknown) { filters[k] = v; return b; },
            limit() { return b; },
            maybeSingle: async () => selectResult(list, filters),
            then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve().then(() => selectResult(list, filters)).then(res, rej),
          };
          return b;
        },

        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const bad = Object.keys(patch).filter((k) => !columns.has(k));
          const commit = async (): Promise<Result> => {
            /* The whole point: naming ONE unknown key rejects the ENTIRE update. */
            if (bad.length) return { data: null, error: { code: "42703", message: undefinedCol(bad[0]).message } };
            const ok = Object.entries(filters).every(([k, v]) => state.row[k] === v);
            if (ok) state.row = { ...state.row, ...patch };
            return { data: ok ? state.row : null, error: null };
          };
          const b: Record<string, unknown> = {
            eq(k: string, v: unknown) { filters[k] = v; return b; },
            select() { return b; },
            maybeSingle: commit,
            then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve().then(commit).then(res, rej),
          };
          return b;
        },
      };
    },
  };

  return { sb, state };
}

let pass = 0, total = 0;
const check = (name: string, ok: boolean, extra = "") => {
  total++; if (ok) pass++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

/* The probe result is cached per table+candidate for 60s, keyed the same way
   in every section below. Without resetting between sections, section 4 would
   silently reuse section 2's "production columns" answer and the migrated-schema
   case would be testing nothing. Each section therefore starts cold. */
function section(title: string) {
  resetColumnProbe();
  console.log(`\n${title}`);
}

const fullPatch = {
  status: "accepted",
  rider_id: "33333333-3333-3333-3333-333333333333",
  rider_name: "Test",
  accepted_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

section("1. The old behaviour: an unfiltered patch against production's schema");
{
  const old = makeDb(row, PROD_COLUMNS);
  const res = await old.sb.from(TABLE)
    .update(fullPatch).eq("id", row.id).eq("status", "requested").select("*").maybeSingle();
  const err = res.error as { code?: string; message?: string } | null;
  check("rejected outright by PostgREST", !!err, err?.message?.slice(0, 46));
  check("error code is 42703 (undefined_column)", err?.code === "42703");
  check("ride was never claimed", old.state.row.status === "requested");
  check("rider was never recorded", old.state.row.rider_id === null);
}

section("2. The new behaviour: the handler's filtered patch");
{
  const fresh = makeDb(row, PROD_COLUMNS);
  const patch = await writableUpdate(fresh.sb, TABLE, fullPatch);
  console.log(`      kept: ${Object.keys(patch).sort().join(", ")}`);
  check("drops the column production lacks", !("accepted_at" in patch));
  check("keeps every column production HAS", ["status", "rider_id", "rider_name", "updated_at"].every((k) => k in patch));

  const res = await fresh.sb.from(TABLE)
    .update(patch).eq("id", row.id).eq("status", "requested").select("*").maybeSingle();
  check("NOT rejected", !res.error, (res.error as Error | null)?.message?.slice(0, 46));
  check("a row comes back", !!res.data);
  check("the ride is now ACCEPTED", fresh.state.row.status === "accepted");
  check("the rider is recorded", fresh.state.row.rider_id === fullPatch.rider_id);
  check("the rider name is recorded", fresh.state.row.rider_name === "Test");
}

section("3. A lost race is still reported as a lost race, not a claim");
{
  const fresh = makeDb(row, PROD_COLUMNS);
  const patch = await writableUpdate(fresh.sb, TABLE, fullPatch);
  /* Another rider wins first — status is no longer 'requested'. */
  fresh.state.row.status = "accepted";
  const res = await fresh.sb.from(TABLE)
    .update(patch).eq("id", row.id).eq("status", "requested").select("*").maybeSingle();
  check("no error is raised (the write was legal)", !res.error);
  check("no row comes back — the .eq() guard did its job", res.data === null);
}

section("4. Same test against a fully migrated schema");
{
  const migrated = makeDb(row, new Set([...PROD_COLUMNS, "accepted_at", "started_at", "completed_at"]));
  const full = await writableUpdate(migrated.sb, TABLE, fullPatch);
  check("accepted_at is kept once the migration is applied", "accepted_at" in full);
  const res = await migrated.sb.from(TABLE)
    .update(full).eq("id", row.id).eq("status", "requested").select("*").maybeSingle();
  check("no error there either", !res.error);
  check("ride accepted there too", migrated.state.row.status === "accepted");
  check("the timestamp is written", typeof migrated.state.row.accepted_at === "string");
}

section("5. A probe that cannot reach a verdict must not silently no-op");
{
  const flaky = makeDb(row, PROD_COLUMNS);
  const boom = { ...flaky.sb, from: () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); } };
  /* `writableUpdate` catches the probe failure and writes UNFILTERED on purpose:
     a loud database error beats a filtered patch that reports success and
     changes nothing. */
  const out = await writableUpdate(boom as never, TABLE, fullPatch);
  check("patch is returned unchanged when the probe fails", Object.keys(out).length === Object.keys(fullPatch).length);
}

console.log(`\n${pass} passed, ${total - pass} failed\n`);
process.exit(pass === total ? 0 : 1);