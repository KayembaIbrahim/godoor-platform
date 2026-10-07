import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";
import { pushToUser } from "@/lib/web-push-server";
import {
  startStopover,
  endStopover,
  disputeStopover,
  isStopoverReason,
  STOPOVER_REASON_LABEL,
  stopoverSchemaReady,
  type StopoverReason,
} from "@/lib/stopover-server";

/**
 * Rider-declared stopover ("waiting on customer").
 *
 *   POST { rideId, action: "start",   reason }  → rider only
 *   POST { rideId, action: "end" }               → rider only
 *   POST { rideId, action: "dispute", reason, note } → customer only
 *   GET  ?rideId=                                 → live view for either party
 *
 * The rider-declared model replaces the old "bill any stationary period"
 * behaviour. Nothing is added to a fare unless a rider opened a stopover, the
 * customer was told while the clock ran, and the session closed inside the
 * per-session and per-ride caps. The customer's alert is pushed from here rather
 * than from the UI, because a customer who only sees it when they happen to open
 * the app has not really been told.
 */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  /* GET is gated on the schema but POST was not. Until FARE_SCHEMA.sql is
     applied, `ride_stopovers` and `ride_stopover_disputes` do not exist, so every
     write below would fail INSIDE a helper that swallows its error — the caller
     would get `{ ok: true }` for a dispute that was never recorded, and for a
     stopover clock that was never opened. The UI hides the control because it
     reads GET, but the endpoint itself has to refuse. */
  if (!(await stopoverSchemaReady(sb))) {
    return NextResponse.json({ error: "Waiting time is not enabled yet" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const rideId = typeof body.rideId === "string" && isUuid(body.rideId) ? body.rideId : null;
  const action = typeof body.action === "string" ? body.action : "";
  if (!rideId) return NextResponse.json({ error: "Ride id required" }, { status: 400 });

  /* ── Start ─────────────────────────────────────────────────────────────── */
  if (action === "start") {
    const reason: StopoverReason = isStopoverReason(body.reason) ? body.reason : "other";
    const res = await startStopover(sb, rideId, actor.id, reason);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

    /* Tell the customer the moment the clock starts. A double-tap returns the
       existing session, and we must not re-alert for it. */
    if (!res.alreadyOpen) {
      void notifyCustomer(sb, rideId, {
        title: `${STOPOVER_REASON_LABEL[reason]}`,
        body: `Waiting time is now billing. Check the running cost on your trip.`,
        tag: `stopover-${rideId}`,
      });
    }
    return NextResponse.json({ ...res, ok: true });
  }

  /* ── End ───────────────────────────────────────────────────────────────── */
  if (action === "end") {
    const res = await endStopover(sb, rideId, actor.id, "rider");
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

    if (res.closed) {
      void notifyCustomer(sb, rideId, {
        title: "Your rider is on the way again",
        body:
          res.chargeUgx > 0
            ? `Wait of ${Math.round(res.minutes)} min added UGX ${res.chargeUgx.toLocaleString("en-US")} to your fare.`
            : "The wait ended within your free waiting time — no extra charge.",
        tag: `stopover-${rideId}`,
      });
    }
    return NextResponse.json({ ...res, ok: true });
  }

  /* ── Dispute ───────────────────────────────────────────────────────────── */
  if (action === "dispute") {
    const res = await disputeStopover(
      sb,
      rideId,
      actor.id,
      typeof body.reason === "string" ? body.reason : "incorrect_wait",
      typeof body.note === "string" ? body.note : undefined,
    );
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** Live stopover state, for the customer's ticking counter and the rider's button. */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  const rideId = req.nextUrl.searchParams.get("rideId") ?? "";
  if (!isUuid(rideId)) return NextResponse.json({ error: "Ride id required" }, { status: 400 });

  /* 503 is how the client learns the feature is switched off, so the UI can hide
     the control instead of offering a button that cannot work. */
  if (!(await stopoverSchemaReady(sb))) {
    return NextResponse.json({ error: "Waiting time is not enabled yet" }, { status: 503 });
  }

  const { loadFareRates } = await import("@/lib/fare-config-server");
  const { stopoverLiveView } = await import("@/lib/stopover-server");
  const { readStopover } = await import("@/lib/stopover-store");
  const rates = await loadFareRates(sb);

  /* Only columns that exist in every deployment. The stopover_* columns this
     used to select were never applied in production, and PostgREST rejects the
     whole SELECT when any named column is unknown. */
  const { data } = await sb
    .from("ride_requests")
    .select("id, customer_id, rider_id, status")
    .eq("id", rideId)
    .maybeSingle();
  const ride = data as Record<string, unknown> | null;
  if (!ride) return NextResponse.json({ error: "Ride not found" }, { status: 404 });

  /* Participants only. A stopover view reveals whether a specific rider is
     waiting, and with whom — that is not public information. */
  const isCustomer = String(ride.customer_id || "") === actor.id;
  const isRider = String(ride.rider_id || "") === actor.id;
  if (!isCustomer && !isRider) {
    return NextResponse.json({ error: "This is not your ride" }, { status: 403 });
  }

  /* Waiting-time state lives in the kv store; adapt it to the flat shape the
     pure view builder expects so there is still exactly one implementation of
     the billing maths. */
  const rec = await readStopover(sb, rideId);
  const view = stopoverLiveView(
    {
      stopover_open_id: rec.open?.id ?? null,
      stopover_open_at: rec.open?.startedAt ?? null,
      stopover_reason: rec.open?.reason ?? null,
      stopover_minutes: rec.totalMinutes,
      stopover_ugx: rec.totalChargeUgx,
      stopover_disputed: rec.dispute ? !rec.dispute.resolved : false,
      stopover_waived: rec.dispute?.waived === true,
    },
    rates,
  );

  return NextResponse.json({
    stopover: view,
    viewer: isCustomer ? "customer" : "rider",
  });
}

/** Push to the customer of a ride, addressed by resolving the ride's customer. */
async function notifyCustomer(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  rideId: string,
  msg: { title: string; body: string; tag: string },
): Promise<void> {
  try {
    const { data } = await sb.from("ride_requests").select("customer_id").eq("id", rideId).maybeSingle();
    const customerId = (data as Record<string, unknown> | null)?.customer_id as string | null;
    if (!customerId) return;
    await pushToUser(sb, customerId, { ...msg, url: `/ride?rideId=${rideId}` });
  } catch {
    // Push is a convenience, never a dependency.
  }
}
