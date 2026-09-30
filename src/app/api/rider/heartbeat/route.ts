import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";

/**
 * Rider liveness heartbeat.
 *
 * `riders.status` used to be a manual toggle, so a rider who flipped it to
 * "online" and then closed the app stayed "online" forever — which is how four
 * riders could all read as online while none of them was reporting a position.
 *
 * The rider app beats here while it is open. `last_seen_at` is the real
 * signal; status is derived from it at read time, so it cannot go stale.
 *
 * A suspension set by an admin always wins: this never resurrects a suspended
 * rider back to "online".
 */

const ONLINE_WINDOW_S = 90;
const AWAY_WINDOW_S = 600;

export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  // A rider is anyone with a riders row. Verified riders are the only ones
  // customers can track, so liveness is only recorded for them.
  const { data: rider } = await sb
    .from("riders")
    .select("id, status")
    .eq("id", actor.id)
    .maybeSingle();

  if (!rider) return NextResponse.json({ ok: false, reason: "not_a_rider" });

  const now = new Date().toISOString();
  const suspended = rider.status === "suspended";

  const { error } = await sb
    .from("riders")
    .update({ last_seen_at: now, ...(suspended ? {} : { status: "online" }) })
    .eq("id", actor.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    last_seen_at: now,
    suspended,
    windows: { online_s: ONLINE_WINDOW_S, away_s: AWAY_WINDOW_S },
  });
}
