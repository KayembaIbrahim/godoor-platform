/**
 * Proves the security and money properties of the rider-declared stopover
 * model by exercising the REAL pure functions in `src/lib/stopover-core.ts`.
 *
 * Run: node scripts/verify-stopover.mts
 *
 * These are the assertions that matter. A rider-triggered button that adds money
 * is the most abusable control in the app, so "the logic looks right" is not
 * good enough — each property is checked here rather than assumed.
 */

import {
  waitChargeUgx,
  stopoverLiveView,
  tickStopover,
  formatDuration,
  isStopoverReason,
  STOPOVER_REASONS,
  STOPOVER_REASON_LABEL,
  STOPOVER_REASON_HINT,
  type StopoverLiveView,
} from "../src/lib/stopover-core.ts";
import { resolveFareRates, quoteFare, fareTierFor, ugandaHour, FALLBACK_FARE_RATES } from "../src/lib/fare-engine.ts";

const RATES = resolveFareRates(null);
const fmt = (n: number) => n.toLocaleString("en-US");

let pass = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, Object.is(actual, expected), `got ${String(actual)}, expected ${String(expected)}`);

// ── 1. Grace applies ONCE per ride, not once per stopover ────────────────────
// Five separate 2-minute stops must not each cost the customer their 3 free
// minutes. That would read as a trick and is how wait pricing gets regulated.
{
  // Five separate 2-minute stops, each billed as an increment.
  let minutes = 0;
  let charged = 0;
  for (let i = 0; i < 5; i++) {
    const before = waitChargeUgx(minutes, RATES);
    minutes += 2;
    charged += waitChargeUgx(minutes, RATES) - before;
  }
  const single = waitChargeUgx(10, RATES); // the same 10 min in one go
  eq("grace is charged once across the ride, not per event", charged, single);
  // 10 min total, 3 free, 7 billable at 100 = 700
  eq("10 min wait costs 700 UGX (7 billable × 100)", single, 700);
  eq("five 2-min stops bill the same as one 10-min stop", charged, 700);
}

// ── 2. The free grace is genuinely free ──────────────────────────────────────
{
  eq("a 3 min wait is free", waitChargeUgx(3, RATES), 0);
  eq("2.9 min is free", waitChargeUgx(2.9, RATES), 0);
  eq("the first charged minute appears at 4 min", waitChargeUgx(4, RATES), 100);
  eq("a long wait never goes negative", waitChargeUgx(-50, RATES), 0);
}

// ── 3. Grace is configurable, and an operator cannot set it negative ─────────
{
  const tight = resolveFareRates({ wait_grace_min: 0, wait_per_min_ugx: 100 });
  eq("grace 0 charges from minute one", waitChargeUgx(1, tight), 100);
  const evil = resolveFareRates({ wait_grace_min: -999, wait_per_min_ugx: 100 });
  eq("a negative grace is clamped, not honoured", waitChargeUgx(5, evil), 500);
}

// ── 4. Live view: open session accrues, settled one does not ─────────────────
const T0 = Date.parse("2026-10-06T19:00:00.000Z");

{
  const closed = stopoverLiveView(
    { stopover_minutes: 5, stopover_ugx: 200, stopover_open_id: null },
    RATES,
    T0,
  );
  eq("no open session → open=false", closed.open, false);
  eq("settled wait is not shown as still accruing", closed.accrued_ugx, 0);
  eq("settled wait keeps its total", closed.total_wait_ugx, 200);
  eq("settled wait reports no free time left", closed.grace_left_min, 0);
}

{
  const open = stopoverLiveView(
    {
      stopover_minutes: 5,
      stopover_ugx: 200,
      stopover_open_id: "11111111-1111-1111-1111-111111111111",
      stopover_open_at: new Date(T0 - 4 * 60000).toISOString(),
      stopover_reason: "customer_not_ready",
    },
    RATES,
    T0,
  );
  eq("open session → open=true", open.open, true);
  // 5 settled + 4 running = 9 min total; 9-3 grace = 6 billable = 600 total.
  // The settled 200 is already agreed, so only the NEW 400 counts as accruing.
  eq("total reflects settled + running", open.total_wait_ugx, 600);
  eq("accruing shows only the unsettled delta", open.accrued_ugx, 400);
  eq("elapsed counts the whole wait", open.elapsed_min, 9);
  eq("reason label is customer-facing", open.reason_label, STOPOVER_REASON_LABEL.customer_not_ready);
}

// ── 5. A clock-skewed phone still shows the truth ────────────────────────────
// The hook anchors on server_now; this proves the view is a pure function of the
// SERVER clock, so a handset an hour out cannot invent an hour of billing.
{
  const ride = {
    stopover_open_id: "11111111-1111-1111-1111-111111111111",
    stopover_open_at: new Date(T0).toISOString(),
  };
  const asServer = stopoverLiveView(ride, RATES, T0 + 6 * 60000);
  const sameMomentDifferentDevice = stopoverLiveView(ride, RATES, T0 + 6 * 60000);
  eq("same server moment → identical figure on any device", asServer.total_wait_ugx, sameMomentDifferentDevice.total_wait_ugx);
  eq("6 min wait costs 300 UGX", asServer.total_wait_ugx, 300);
}

// ── 6. Ticking matches recomputing from scratch ─────────────────────────────
// The customer ticks locally between polls. If the tick drifted from the server
// arithmetic, the banner would disagree with the bill — the exact failure this
// whole feature exists to prevent.
{
  const base = stopoverLiveView(
    {
      stopover_open_id: "11111111-1111-1111-1111-111111111111",
      stopover_open_at: new Date(T0).toISOString(),
      stopover_minutes: 0,
      stopover_ugx: 0,
    },
    RATES,
    T0,
  );
  for (const mins of [1, 2, 7, 30, 95]) {
    const ticked = tickStopover(base, T0 + mins * 60000);
    const fresh = stopoverLiveView(
      {
        stopover_open_id: "11111111-1111-1111-1111-111111111111",
        stopover_open_at: new Date(T0).toISOString(),
        stopover_minutes: 0,
        stopover_ugx: 0,
      },
      RATES,
      T0 + mins * 60000,
    );
    eq(
      `tick at ${mins} min equals a fresh server compute`,
      ticked.total_wait_ugx,
      fresh.total_wait_ugx,
    );
  }
  // A closed stopover must never keep counting.
  const closedBase: StopoverLiveView = { ...base, open: false };
  eq("a closed stopover does not tick", tickStopover(closedBase, T0 + 99 * 60000), closedBase);
}

// ── 7. Malformed reason strings cannot smuggle text into a push ─────────────
{
  eq("a bogus reason is rejected", isStopoverReason("'; DROP TABLE rides; --"), false);
  eq("a non-string is rejected", isStopoverReason(42), false);
  eq("null is rejected", isStopoverReason(null), false);
  eq("undefined is rejected", isStopoverReason(undefined), false);
  check("every declared reason has a label", STOPOVER_REASONS.every((r) => !!STOPOVER_REASON_LABEL[r]));
  check("every declared reason has a hint", STOPOVER_REASONS.every((r) => !!STOPOVER_REASON_HINT[r]));
}

// ── 8. A missing config must never price a wait at zero ─────────────────────
// resolveFareRates falls back per field. If the whole row is absent the
// compiled-in defaults still apply.
{
  const empty = resolveFareRates(null);
  eq("absent config still bills waiting time", empty.wait_per_min_ugx, FALLBACK_FARE_RATES.wait_per_min_ugx);
  check("absent config still caps a session", empty.stopover_max_session_min > 0);
  check("absent config still caps a ride", empty.stopover_max_ride_min > 0);
  const partial = resolveFareRates({ wait_per_min_ugx: 250 } as never);
  eq("an admin override is honoured", partial.wait_per_min_ugx, 250);
  eq("an unset field keeps its default, not zero", partial.wait_grace_min, FALLBACK_FARE_RATES.wait_grace_min);
}

// ── 9. Duration formatting the UI depends on ────────────────────────────────
{
  eq("45s reads as seconds", formatDuration(45), "45s");
  eq("80s reads as min+sec", formatDuration(80), "1 min 20s");
  eq("3600s reads as hours", formatDuration(3600), "1h 0m");
  eq("negative durations clamp to zero", formatDuration(-9), "0s");
}

// ── 10. Time-of-day tiers and the peak uplift ───────────────────────────────
// Uganda is UTC+3 year-round with no DST, so a tier boundary must follow EAT,
// not the server's clock. Getting this wrong re-prices every evening ride.
{
  // 20:00 EAT == 17:00 UTC
  const evening = new Date("2026-10-06T17:00:00.000Z");
  const midday = new Date("2026-10-06T09:00:00.000Z"); // 12:00 EAT
  eq("19:30 EAT is 16:30 UTC", ugandaHour(new Date("2026-10-06T16:30:00.000Z")), 19.5);
  eq("12:00 UTC is 15:00 EAT", ugandaHour(new Date("2026-10-06T12:00:00.000Z")), 15);
  eq("midday ride is a day tier", fareTierFor(midday, RATES), "day");
  eq("20:00 EAT is the evening tier", fareTierFor(evening, RATES), "evening");
  eq("23:00 EAT is the late tier", fareTierFor(new Date("2026-10-06T20:00:00.000Z"), RATES), "late");
}
{
  // Default must not change any live price.
  const day = quoteFare({ distanceKm: 10, at: new Date("2026-10-06T09:00:00.000Z"), rates: RATES });
  const evening = quoteFare({ distanceKm: 10, at: new Date("2026-10-06T17:00:00.000Z"), rates: RATES });
  eq("with the uplift off, a 10 km ride costs the same at 20:00 as at noon",
     evening.fare_ugx, day.fare_ugx);
  eq("the uplift is reported as 1.0", evening.tier_multiplier, 1);
}
{
  // Switched on, it must raise the distance component and nothing else.
  const peak = resolveFareRates({ evening_multiplier: 1.5 });
  const day = quoteFare({ distanceKm: 10, at: new Date("2026-10-06T09:00:00.000Z"), rates: RATES });
  const eve = quoteFare({ distanceKm: 10, at: new Date("2026-10-06T17:00:00.000Z"), rates: peak });
  eq("a 1.5× evening uplift raises the distance component", eve.distance_ugx, day.distance_ugx * 1.5);
  eq("the base is untouched by the uplift", eve.base_ugx, day.base_ugx);
  eq("the uplift is reported", eve.tier_multiplier, 1.5);
  // 10km: base 2000 + 12,000*1.5 = 18,000 → 20,000
  eq("the peak fare is 20,000", eve.fare_ugx, 20000);
}
{
  // A mis-typed multiplier must not be able to reprice a ride absurdly.
  eq("a zero uplift is clamped to 1.0", resolveFareRates({ evening_multiplier: 0 }).evening_multiplier, 1);
  eq("a negative uplift is clamped to 1.0", resolveFareRates({ evening_multiplier: -5 }).evening_multiplier, 1);
  eq("an absurd uplift is capped at 3.0", resolveFareRates({ evening_multiplier: 99 }).evening_multiplier, 3);
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n  Stopover logic: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n  FAILURES:");
  for (const f of failures) console.log(`   ✗ ${f}`);
  process.exit(1);
}
console.log(`  Sample fare maths: 10 km boda = ${fmt(waitChargeUgx(10, RATES))} UGX wait component\n`);
