/**
 * Proves the ANTI-FRAUD guards in `src/lib/stopover-server.ts` by running the
 * real functions against an in-memory Supabase double.
 *
 * Run: node scripts/verify-stopover-guards.mts
 *
 * The pure arithmetic is covered by verify-stopover.mts. What this file exists
 * for is the part that only exists on the server: that a rider cannot open a
 * clock on someone else's trip, cannot open one while driving, cannot open two,
 * cannot open one instantly after closing one, and cannot exceed the caps.
 *
 * The double models the two things the guards lean on:
 *   • `app_settings.key` being the PRIMARY KEY, so a concurrent open-clock insert
 *     returns 23505 — the guarantee the dedicated schema used to give via a
 *     partial unique index
 *   • the per-ride JSON record being the authoritative total
 */

import {
  startStopover,
  endStopover,
  autoCloseIfMoving,
  disputeStopover,
  waitChargeUgx,
} from "../src/lib/stopover-server.ts";
import { resolveFareRates } from "../src/lib/fare-engine.ts";

/* ── A small but faithful Supabase double ──────────────────────────────────── */

type Row = Record<string, any>;

const TABLES: Record<string, Row[]> = {
  ride_requests: [],
  app_settings: [],
  rider_locations: [],
  fare_rates: [],
};

/** Read the stopover record the production store would return. */
function stopoverRec(rideId: string): Row | null {
  const row = TABLES.app_settings.find((r) => r.key === `stopover:${rideId}`);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function lockCount(rideId: string): number {
  return TABLES.app_settings.filter((r) => r.key === `stopover:lock:${rideId}`).length;
}

/** Backdate the open clock so End bills a wait of the given length. */
function backdateOpen(rideId: string, ms: number): void {
  const row = TABLES.app_settings.find((r) => r.key === `stopover:${rideId}`);
  if (!row) return;
  const rec = JSON.parse(row.value);
  rec.open.startedAt = new Date(Date.now() - ms).toISOString();
  row.value = JSON.stringify(rec);
}

/** The most recent recorded session, i.e. the closed one just appended. */
function lastSession(rideId: string): Row | null {
  const rec = stopoverRec(rideId);
  return rec && rec.sessions.length ? rec.sessions[rec.sessions.length - 1] : null;
}

function reset(state: {
  riderId: string;
  customerId: string;
  speed: number;
  gpsAgeMs: number;
  status: string;
  rideId: string;
}) {
  for (const k of Object.keys(TABLES)) TABLES[k] = [];
  TABLES.fare_rates = [{ id: "default", ...resolveFareRates(null) }];
  TABLES.ride_requests = [
    {
      id: state.rideId,
      rider_id: state.riderId,
      customer_id: state.customerId,
      status: state.status,
      finalised: false,
      wait_min: 0,
      wait_ugx: 0,
      fare_ugx: 8000,
      service_fee_ugx: 1200,
      total_ugx: 9200,
    },
  ];
  TABLES.rider_locations = [
    {
      rider_id: state.riderId,
      lat: 0.3476,
      lng: 32.5825,
      speed: state.speed,
      updated_at: new Date(Date.now() - state.gpsAgeMs).toISOString(),
    },
  ];
}

/** Chainable no-op builder over the in-memory tables. */
function table(name: string) {
  const rows = () => TABLES[name];
  /* Symbol filters stand for `.not(col, "is", null)` and are applied
     separately below — comparing a row against the symbol would reject every
     row before the real predicate ever ran. */
  const matches = (r: Row, f: [string, unknown][]) =>
    f.every(([k, v]) => typeof v === "symbol" || r[k] === v);
  const notNull = (f: [string, unknown][]) => {
    const sym = f.find(([, v]) => typeof v === "symbol");
    return sym ? f.filter(([, v]) => typeof v !== "symbol") : f;
  };

  const builder: any = {
    _f: [] as [string, unknown][],
    select: () => builder,
    eq(k: string, v: unknown) {
      if (v !== undefined) builder._f.push([k, v]);
      return builder;
    },
    not(k: string, op: string, v: unknown) {
      if (op === "is" && v === null) builder._f.push([k, Symbol.for("nonnull")]);
      return builder;
    },
    in(k: string, v: unknown[]) {
      builder._f.push([k, v]);
      return builder;
    },
    order() {
      return builder;
    },
    limit(n: number) {
      builder._n = n;
      return builder;
    },
    maybeSingle: async () => {
      const out = rows().filter((r) => matches(r, notNull(builder._f)));
      return { data: out[0] ?? null, error: null };
    },
    then: (res: any) => res({ data: rows().filter((r) => matches(r, notNull(builder._f))), error: null }),
    insert: (payload: Row) => {
      /* Model `app_settings_pkey`: a duplicate key is a hard 23505, which is
         exactly what makes two simultaneous open-clock taps resolve to one. */
      if (payload.key !== undefined) {
        if (rows().some((r) => r.key === payload.key)) {
          return {
            select: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { code: "23505", message: "duplicate key value violates unique constraint" },
              }),
            }),
            then: (res: any) =>
              res({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }),
          };
        }
      }
      const row = { id: `st-${rows().length + 1}`, ...payload };
      rows().push(row);
      return {
        select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        then: (res: any) => res({ data: row, error: null }),
      };
    },
    upsert: (payload: Row, _opts?: unknown) => {
      const idx = rows().findIndex((r) => r.key === payload.key);
      if (idx >= 0) rows()[idx] = { ...rows()[idx], ...payload };
      else rows().push({ ...payload });
      return {
        select: () => ({ maybeSingle: async () => ({ data: payload, error: null }) }),
        then: (res: any) => res({ data: payload, error: null }),
      };
    },
    delete: () => {
      const doIt = async () => {
        const hit = rows().filter((r) => matches(r, notNull(builder._f)));
        for (const r of hit) rows().splice(rows().indexOf(r), 1);
        return { data: hit, error: null };
      };
      const chain: any = {
        eq(k: string, v: unknown) {
          builder._f.push([k, v]);
          return chain;
        },
        then: (res: any) => doIt().then(res),
      };
      return chain;
    },
    update: (patch: Row) => {
      const doIt = async () => {
        const hit = rows().filter((r) => matches(r, notNull(builder._f)));
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit, error: null };
      };
      return {
        eq(k: string, v: unknown) {
          builder._f.push([k, v]);
          return this;
        },
        select: () => ({ maybeSingle: doIt }),
        then: (res: any) => doIt().then(res),
      };
    },
  };
  return builder;
}

const sb: any = { from: (n: string) => table(n) };

/* ── Assertions ────────────────────────────────────────────────────────────── */

let pass = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const RIDER = "11111111-1111-1111-1111-111111111111";
const OTHER_RIDER = "22222222-2222-2222-2222-222222222222";
const CUSTOMER = "33333333-3333-3333-3333-333333333333";
const RIDE = "44444444-4444-4444-4444-444444444444";

const fresh = (over: Partial<Parameters<typeof reset>[0]> = {}) =>
  reset({ riderId: RIDER, customerId: CUSTOMER, speed: 0, gpsAgeMs: 0, status: "in_progress", rideId: RIDE, ...over });

// ── IDOR: a rider cannot bill someone else's trip ───────────────────────────
{
  fresh();
  const res = await startStopover(sb, RIDE, OTHER_RIDER, "other");
  check("a rider cannot open a wait on another rider's trip", !res.ok && res.status === 403,
    JSON.stringify(res));
  check("the rejected attempt created no session", stopoverRec(RIDE) === null);
}

// ── State: a wait cannot exist outside an active trip ───────────────────────
{
  fresh({ status: "requested" });
  const res = await startStopover(sb, RIDE, RIDER, "other");
  check("a wait cannot start before the trip begins", !res.ok && res.status === 409);
}
{
  fresh();
  await sb.from("fare_rates").update({ id: "default" }).eq("id", "default");
  TABLES.ride_requests[0].finalised = true;
  const res = await startStopover(sb, RIDE, RIDER, "other");
  check("a wait cannot start after the fare is settled", !res.ok && res.status === 409);
}

// ── GPS: the anti-fraud check that makes the button trustworthy ─────────────
{
  // speed is m/s in the app; 5 m/s = 18 km/h, i.e. clearly driving.
  fresh({ speed: 5 }); // 5 m/s = 18 km/h
  const res = await startStopover(sb, RIDE, RIDER, "customer_not_ready");
  check("a wait is refused while the vehicle is moving", !res.ok && res.status === 409,
    JSON.stringify(res));
  check("the moving rider's message explains why", !res.ok && /moving/i.test(res.error));
}
{
  fresh({ gpsAgeMs: 10 * 60_000 }); // 10 minutes stale
  const res = await startStopover(sb, RIDE, RIDER, "other");
  check("a wait is refused on a stale GPS fix", !res.ok && /GPS/i.test(res.error));
}
{
  fresh({ speed: 1 }); // 3.6 km/h — genuinely crawling in traffic
  const res = await startStopover(sb, RIDE, RIDER, "other");
  check("a genuinely stopped rider CAN start a wait", res.ok && !res.alreadyOpen, JSON.stringify(res));
}

// ── Idempotency: a double-tap cannot open two clocks ────────────────────────
{
  fresh({ speed: 0 });
  const a = await startStopover(sb, RIDE, RIDER, "other");
  const b = await startStopover(sb, RIDE, RIDER, "other");
  check("a second tap returns the same session", a.stopoverId === b.stopoverId);
  check("a second tap is reported as already open", b.alreadyOpen === true);
  check("only ONE open clock is held", lockCount(RIDE) === 1);
  check("the record has exactly one open session", (stopoverRec(RIDE)?.open ? 1 : 0) === 1);
}

// ── Cooldown: tap-tap-tap cannot farm the meter ────────────────────────────
{
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  // Backdate the open session so End bills a real, long wait.
  backdateOpen(RIDE, 10 * 60000);
  await endStopover(sb, RIDE, RIDER);
  const again = await startStopover(sb, RIDE, RIDER, "other");
  check("a wait cannot be reopened during the cooldown", !again.ok && /min/i.test(again.error),
    JSON.stringify(again));
}

// ── Caps: one event cannot drain a wallet ───────────────────────────────────
{
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  // 3 hours of waiting — far beyond the per-session cap.
  backdateOpen(RIDE, 180 * 60000);
  const res = await endStopover(sb, RIDE, RIDER);
  const cap = resolveFareRates(null).stopover_max_session_min;
  check("a stopover is capped per session", res.ok && res.minutes === cap,
    `minutes=${res.ok ? res.minutes : res.error}`);
  const expected = waitChargeUgx(cap, resolveFareRates(null));
  check("the capped charge matches the rate maths", res.ok && res.totalWaitUgx === expected,
    `got ${res.ok ? res.totalWaitUgx : "-"} expected ${expected}`);
}

// ── Short taps are voided, not billed ───────────────────────────────────────
{
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  // 4 seconds — below the 1-minute floor.
  backdateOpen(RIDE, 4000);
  const res = await endStopover(sb, RIDE, RIDER);
  check("a 4-second tap bills nothing", res.ok && res.chargeUgx === 0);
  check("a 4-second tap is recorded as void", lastSession(RIDE)?.closeReason === "too_short");
}

// ── Ending is idempotent ────────────────────────────────────────────────────
{
  fresh({ speed: 0 });
  const first = await endStopover(sb, RIDE, RIDER);
  const second = await endStopover(sb, RIDE, RIDER);
  check("ending with no open wait is a no-op success", first.ok && !first.closed);
  check("a repeated End cannot double-bill", second.ok && second.chargeUgx === 0);
}

// ── Auto-close: a rider cannot leave the meter running while driving ────────
{
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "customer_not_ready");
  backdateOpen(RIDE, 8 * 60000);
  const res = await autoCloseIfMoving(sb, RIDER, 28.8); // km/h (8 m/s)
  check("moving again closes the open wait automatically", !!res);
  check("the auto-closed wait was billed", !!res && res.chargeUgx > 0);
  check("no wait is left open", stopoverRec(RIDE)?.open === null);
  check("auto-close records why", lastSession(RIDE)?.closeReason === "auto_movement");
}
{
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  const res = await autoCloseIfMoving(sb, RIDER, 1.8); // km/h — creeping in traffic
  check("creeping in traffic does NOT close the wait", res === null);
}

// ── Dispute: a customer can contest, and only their own ride ────────────────
{
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  backdateOpen(RIDE, 12 * 60000);
  await endStopover(sb, RIDE, RIDER);

  const wrong = await disputeStopover(sb, RIDE, OTHER_RIDER, "incorrect_wait");
  check("a non-customer cannot dispute a ride", !wrong.ok);
  const right = await disputeStopover(sb, RIDE, CUSTOMER, "incorrect_wait", "I was ready");
  check("the customer CAN dispute their own wait", right.ok);
  const dup = await disputeStopover(sb, RIDE, CUSTOMER, "incorrect_wait");
  check("a second dispute does not stack", dup.ok &&
    (stopoverRec(RIDE)?.dispute && !stopoverRec(RIDE).dispute.resolved) === true);
  check("the ride is flagged as disputed", TABLES.ride_requests[0].stopover_disputed === true);
}
{
  fresh();
  const res = await disputeStopover(sb, RIDE, CUSTOMER, "incorrect_wait");
  check("a ride with no wait charge cannot be disputed", !res.ok);
}

// ── REGRESSION: the m/s vs km/h bug ─────────────────────────────────────────
// `rider_locations.speed` is metres/second. The auto-close threshold is km/h.
// Feeding one into the other disabled the anti-fraud control entirely: a rider
// doing 4 m/s (14 km/h) read as 4 km/h and kept billing while driving.
{
  // Open the wait while genuinely stopped, then set off — the exact sequence.
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  backdateOpen(RIDE, 9 * 60000);
  TABLES.rider_locations[0].speed = 4; // 4 m/s = 14.4 km/h

  const asKmh = await autoCloseIfMoving(sb, RIDER, 4 * 3.6);
  check("4 m/s is correctly treated as 14.4 km/h and closes the wait", !!asKmh);
}
{
  // The old, wrong call: the raw m/s figure straight through the km/h bar.
  fresh({ speed: 0 });
  await startStopover(sb, RIDE, RIDER, "other");
  const asRaw = await autoCloseIfMoving(sb, RIDER, 4);
  check("the raw m/s value would NOT have closed it (regression guard)", asRaw === null);
}
{
  // Mirror image: a genuinely stationary rider must not be refused a wait.
  fresh({ speed: 0.5 }); // 0.5 m/s = 1.8 km/h
  const res = await startStopover(sb, RIDE, RIDER, "other");
  check("a rider creeping at 1.8 km/h can still declare a wait", res.ok);
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n  Stopover security guards: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n  FAILURES:");
  for (const f of failures) console.log(`   ✗ ${f}`);
  process.exit(1);
}
console.log("  IDOR, state, GPS, idempotency, cooldown, caps, auto-close, dispute — all verified.\n");
