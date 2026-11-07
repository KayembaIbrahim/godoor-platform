import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { pushToUsers } from "@/lib/web-push-server";

export const runtime = "nodejs";

/**
 * SOS — one-tap emergency.
 * POST { rideId?, orderId?, lat?, lng? }
 * 1) Records the incident (app_settings backed — no DDL required).
 * 2) Alerts all other participants of that ride/order via push.
 * 3) Returns the emergency line so the UI can tel: it immediately.
 */
const EMERGENCY_PHONE = process.env.EMERGENCY_PHONE || "+256700000000";

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rideId = body?.rideId ? String(body.rideId) : null;
  const orderId = body?.orderId ? String(body.orderId) : null;
  const lat = body?.lat != null ? Number(body.lat) : null;
  const lng = body?.lng != null ? Number(body.lng) : null;

  const parts: string[] = [];
  if (rideId) parts.push(`ride:${rideId}`);
  if (orderId) parts.push(`order:${orderId}`);
  const ref = parts.join(":") || "general";

  const at = new Date().toISOString();
  const payload = {
    actor: actor.kind === "admin" ? "admin" : actor.id,
    at,
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lng: lng != null && Number.isFinite(lng) ? lng : null,
    ref,
    status: "open",
  };

  // Best-effort durable record in app_settings (no DDL needed).
  try {
    await sb.from("app_settings").upsert({
      key: `sos:${ref}:${at}`,
      value: JSON.stringify(payload),
      updated_at: at,
    });
  } catch {}

  // Alert the other party immediately via push.
  const notifyIds: string[] = [];
  try {
    if (rideId) {
      const { data: ride } = await sb.from("ride_requests").select("customer_id, rider_id").eq("id", rideId).maybeSingle();
      if (ride) {
        const peer = actor.kind === "admin" ? null : (actor.id === ride.customer_id ? ride.rider_id : ride.customer_id);
        if (peer) notifyIds.push(peer);
      }
    }
    if (orderId) {
      const { data: ord } = await sb.from("orders").select("customer_id, rider_id, merchant_id").eq("id", orderId).maybeSingle();
      if (ord) {
        const mine = actor.kind === "admin" ? null : actor.id;
        for (const pid of [ord.customer_id, ord.rider_id, ord.merchant_id]) {
          if (pid && pid !== mine) notifyIds.push(String(pid));
        }
      }
    }
  } catch {}

  if (notifyIds.length) {
    await pushToUsers(sb, notifyIds, {
      title: "SOS — Emergency",
      body: `Someone on this trip triggered SOS. Open the trip and check now.`,
      url: rideId ? `/ride` : "/tracking",
      tag: `sos-${ref}`,
      urgency: "high",
    });
  }

  return NextResponse.json({
    ok: true,
    emergencyPhone: EMERGENCY_PHONE,
    shareUrl: lat != null && lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      : null,
    recordedAt: at,
  });
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "admin") return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const { data } = await sb.from("app_settings").select("key, value, updated_at").like("key", "sos:%").order("updated_at", { ascending: false }).limit(50);
  const incidents = (data || []).map((r) => {
    try { return { key: r.key, updated_at: r.updated_at, ...JSON.parse(r.value as string) }; } catch { return { key: r.key, updated_at: r.updated_at }; }
  });
  return NextResponse.json({ incidents });
}
