/**
 * Live end-to-end probe of the two reported rider bugs, using the real
 * production credentials from .env.vercel-prod and the real deployed API.
 *
 *   1. rider cannot see a ride request  →  GET  /api/rides?open=1
 *   2. "waiting on passenger" dead      →  GET  /api/rides/stopover?rideId=…
 *
 * Read-only. It signs in, calls public endpoints and inspects the database
 * with the service role. It never prints a secret.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.vercel-prod", "utf8").split("\n")) {
  const m = /^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = "https://godoor.site";

const ACCOUNTS = {
  rider: process.env.RIDER_MAIL,
  customer: process.env.CUSTOMER_MAIL,
  business: process.env.BUSINESS_MAIL,
};
const PASS = process.env.ACCOUNT_PASS;

async function signIn(email) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`sign-in failed ${r.status}: ${j.error_description || j.msg || j.error}`);
  return { token: j.access_token, userId: j.user?.id, email: j.user?.email };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json" };
}

function rest(path) {
  return `${SB}/rest/v1/${path}`;
}

async function svc(path, opts = {}) {
  return fetch(rest(path), {
    ...opts,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
};

async function main() {
  console.log("Signing in to PRODUCTION Supabase…\n");
  const sessions = {};
  for (const [role, mail] of Object.entries(ACCOUNTS)) {
    if (!mail) continue;
    try {
      sessions[role] = await signIn(mail);
      console.log(`  ✓ ${role.padEnd(9)} ${mail}  uid=${sessions[role].userId.slice(0, 8)}…`);
    } catch (e) {
      record(`sign-in ${role}`, false, String(e.message));
    }
  }
  console.log("");

  const rider = sessions.rider;
  if (!rider) {
    console.log("No rider session — cannot continue.");
    process.exit(1);
  }

  /* ── BUG 1: rider sees no ride requests ─────────────────────────────── */
  const openRes = await fetch(`${SITE}/api/rides?open=1`, { headers: authHeaders(rider.token) });
  const openJson = await openRes.json().catch(() => ({}));
  record(
    "BUG1  GET /api/rides?open=1",
    openRes.ok,
    `HTTP ${openRes.status} ${openRes.ok ? `→ ${(openJson.rides || []).length} open ride(s)` : `→ ${JSON.stringify(openJson).slice(0, 180)}`}`,
  );

  /* Why is it 403/empty? Check the rider gate server-side. */
  const riderRow = await svc(`riders?user_id=eq.${rider.userId}&select=id,verified,status,full_name`);
  const riderRows = await riderRow.json().catch(() => []);
  record(
    "  ↳ riders row (service role)",
    riderRows.length > 0,
    riderRows.length ? JSON.stringify(riderRows[0]) : "NO riders ROW — gate can never pass",
  );

  const acct = await svc(`account_roles?user_id=eq.${rider.userId}&select=*`);
  const acctRows = await acct.json().catch(() => []);
  record("  ↳ account_roles rows", acctRows.length > 0, acctRows.length ? JSON.stringify(acctRows).slice(0, 200) : "none");

  /* Published table list — realtime depends on this. */
  const pub = await svc("../realtime/publication", { headers: { Accept: "application/json" } });
  let pubList = [];
  try {
    const pj = await pub.json();
    pubList = Array.isArray(pj) ? pj : pj?.tables || [];
  } catch {}
  const hasRide = pubList.some((t) => (t.table ?? t) === "ride_requests");
  record("  ↳ ride_requests in realtime publication", hasRide, hasRide ? "yes — postgres_changes can fire" : "NO — realtime postgres_changes will NEVER fire for riders");

  /* Are there real open ride requests at all? */
  const openReqs = await svc("ride_requests?status=eq.requested&select=id,created_at,customer_name,status");
  const openReqList = await openReqs.json().catch(() => []);
  record("  ↳ open ride_requests in production", Array.isArray(openReqList), Array.isArray(openReqList) ? `${openReqList.length} row(s) with status=requested` : "probe failed");

  /* ── BUG 2: stopover / "waiting on passenger" ───────────────────────── */
  const rideId = (Array.isArray(openReqList) && openReqList[0]?.id) || null;
  if (rideId) {
    const so = await fetch(`${SITE}/api/rides/stopover?rideId=${rideId}`, { headers: authHeaders(rider.token) });
    const soJson = await so.json().catch(() => ({}));
    record("BUG2  GET /api/rides/stopover", so.status !== 503, `HTTP ${so.status} ${JSON.stringify(soJson).slice(0, 160)}`);

    const tbl = await svc("ride_stopovers?select=id&limit=1");
    record("  ↳ ride_stopovers table", tbl.ok, tbl.ok ? "EXISTS in production" : `ABSENT (${tbl.status}) — this is why the button is hidden`);
  } else {
    const so = await svc("ride_stopovers?select=id&limit=1");
    record("BUG2  ride_stopovers table", so.ok, so.ok ? "EXISTS" : `ABSENT (${so.status}) — stopover button is hidden by design until applied`);
  }

  const fare = await svc("fare_rates?select=id&limit=1");
  record("  ↳ fare_rates table", fare.ok, fare.ok ? "EXISTS" : `ABSENT (${fare.status})`);

  /* Which ride_requests columns actually exist? */
  const probe = await svc("ride_requests?select=accepted_at&limit=1");
  const probeErr = await probe.json().catch(() => ({}));
  record("  ↳ ride_requests.accepted_at", !probeErr.code, probeErr.code ? `MISSING — ${probeErr.message}` : "exists");

  const probe2 = await svc("ride_requests?select=stopover_open_at&limit=1");
  const probe2Err = await probe2.json().catch(() => ({}));
  record("  ↳ ride_requests.stopover_open_at", !probe2Err.code, probe2Err.code ? `MISSING — ${probe2Err.message}` : "exists");

  const summary = results.filter((r) => r.pass).length;
  console.log(`\n${summary}/${results.length} checks passed`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
