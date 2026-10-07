/**
 * Proves the rider "Accept" fix against the REAL database, not a mock.
 *
 * Run against a chosen database:
 *   GD_ENV=.env.vercel-prod node --import ./scripts/register-alias.mjs scripts/verify-ride-accept.mts
 *
 * The bug being fixed: `ride_requests` has no `accepted_at` column, and
 * PostgREST rejects an ENTIRE update when any named column is unknown. The
 * handler reported that rejection as "This ride was already taken", so riders
 * were told a ride had been stolen when nobody had claimed it.
 *
 * These assertions run against live PostgREST so they fail for the same reason
 * production fails, rather than passing against a hand-written fake.
 */

import fs from "node:fs";
import { writableUpdate, existingColumns, resetColumnProbe } from "../src/lib/schema-capabilities.ts";

const envFile = process.env.GD_ENV || ".env.local";
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = {
  from(table: string) {
    return {
      select(cols: string) {
        return {
          async limit() {
            const r = await fetch(`${URL_}/rest/v1/${table}?select=${encodeURIComponent(cols)}&limit=1`, {
              headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
            });
            const t = await r.text();
            let message = "";
            try {
              message = JSON.parse(t).message || "";
            } catch {}
            return { error: r.status >= 400 ? { message, code: r.status } : null, data: [] };
          },
        };
      },
    };
  },
};

let pass = 0;
let total = 0;
const check = (name: string, ok: boolean, extra = "") => {
  total++;
  if (ok) pass++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

console.log(`\nDatabase: ${URL_.match(/https:\/\/([a-z]+)\./)?.[1]}  (${envFile})\n`);

/* The fix must be correct in BOTH worlds: on a database that has had
   FARE_SCHEMA.sql applied it keeps every column, and on one that has not it
   drops exactly the missing ones and still lets the claim through. The same
   test asserts whichever of those two is actually true, so it is a real
   regression test on either database rather than one that only passes while
   the schema is outstanding. */
resetColumnProbe();
const probe = await existingColumns(sb, "ride_requests", ["accepted_at"]);
const MIGRATED = probe.has("accepted_at");
console.log(
  `Schema state: ${MIGRATED ? "FARE_SCHEMA.sql APPLIED" : "NOT applied — running in degraded mode"}\n`,
);

console.log("1. The original failure mode");
resetColumnProbe();
const raw = await sb.from("ride_requests")
  .select("status, rider_id, rider_name, accepted_at, updated_at")
  .limit();
check(
  MIGRATED
    ? "accepted_at resolves (migration applied)"
    : "selecting accepted_at is rejected (42703) — the original bug",
  MIGRATED ? raw.error === null : raw.error?.code === 400 && /accepted_at/.test(raw.error?.message || ""),
  raw.error?.message?.slice(0, 60),
);

console.log("\n2. The accept claim");
resetColumnProbe();
const patch = await writableUpdate(sb, "ride_requests", {
  status: "accepted",
  rider_id: actorId(),
  rider_name: "Test",
  accepted_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
console.log(`      kept: ${Object.keys(patch).sort().join(", ")}`);
const resolved = await sb.from("ride_requests").select(Object.keys(patch).join(",")).limit();
check("the claim's columns are all accepted by PostgREST", resolved.error === null, resolved.error?.message);
check(`accepted_at ${MIGRATED ? "kept" : "dropped"}`, MIGRATED === "accepted_at" in patch);
check("status kept (the claim itself)", patch.status === "accepted");
check("rider_id kept (the claim itself)", !!patch.rider_id);

console.log("\n3. start / complete");
resetColumnProbe();
const start = await writableUpdate(sb, "ride_requests", {
  status: "in_progress",
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
check(`started_at ${MIGRATED ? "kept" : "dropped"}`, MIGRATED === "started_at" in start);
check("start keeps status", start.status === "in_progress");
check("start columns resolve", (await sb.from("ride_requests").select(Object.keys(start).join(",")).limit()).error === null);

resetColumnProbe();
const done = await writableUpdate(sb, "ride_requests", {
  status: "completed",
  completed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
check(`completed_at ${MIGRATED ? "kept" : "dropped"}`, MIGRATED === "completed_at" in done);
check("complete keeps status", done.status === "completed");
check("complete columns resolve", (await sb.from("ride_requests").select(Object.keys(done).join(",")).limit()).error === null);

console.log("\n4. No column the database HAS is ever dropped");
resetColumnProbe();
const cols = await existingColumns(sb, "ride_requests", [
  "status", "rider_id", "rider_name", "updated_at", "accepted_at", "definitely_not_a_column",
]);
check("real columns reported present", ["status", "rider_id", "rider_name", "updated_at"].every((c) => cols.has(c)));
check("a column that does not exist is reported absent", !cols.has("definitely_not_a_column"));
check("accepted_at reported per the real schema", cols.has("accepted_at") === MIGRATED);

console.log("\n5. Failure guards (a bad probe must never become a silent no-op)");
const dead = {
  from() {
    return {
      select() {
        return {
          async limit() {
            return { error: { message: "network down" }, data: [] };
          },
        };
      },
    };
  },
};
resetColumnProbe();
const guarded = await writableUpdate(dead, "ride_requests", {
  status: "accepted",
  rider_id: actorId(),
});
check("an unreachable probe writes UNFILTERED rather than empty", Object.keys(guarded).length === 2);
check("an unreachable probe keeps status", guarded.status === "accepted");

resetColumnProbe();
let threw = false;
try {
  await existingColumns(dead, "ride_requests", ["status"]);
} catch {
  threw = true;
}
check("a probe that resolves nothing throws instead of caching a lie", threw);

console.log(`\n${pass} passed, ${total - pass} failed\n`);
process.exit(pass === total ? 0 : 1);

function actorId() {
  return "00000000-0000-0000-0000-000000000000";
}
