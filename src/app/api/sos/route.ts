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

  // Alert the other party immediately via push, and resolve their phone
  // so the SOS UI can offer a one-tap "Call" link without leaving the app.
  const notifyIds: string[] = [];
  let peerPhone: string | null = null;
  let peerName: string | null = null;
  try {
    if (rideId) {
      const { data: ride } = await sb.from("ride_requests").select("customer_id, rider_id, customer_phone, rider_name").eq("id", rideId).maybeSingle();
      if (ride) {
        const peerId = actor.kind === "admin" ? null : (actor.id === ride.customer_id ? ride.rider_id : ride.customer_id);
        if (peerId) {
          notifyIds.push(peerId);
          // The rider's phone lives in riders.phone; the customer's is on the ride row.
          if (peerId === ride.rider_id) {
            const { data: r } = await sb.from("riders").select("phone, name").eq("id", peerId).maybeSingle();
            peerPhone = (r as { phone?: string | null } | null)?.phone || null;
            peerName = ride.rider_name || (r as { name?: string | null } | null)?.name || "your rider";
          } else {
            peerPhone = ride.customer_phone || null;
            peerName = "your customer";
          }
        }
      }
    }
    if (orderId) {
      const { data: ord } = await sb.from("orders").select("customer_id, rider_id, merchant_id, customer_phone, rider_phone").eq("id", orderId).maybeSingle();
      if (ord) {
        const mine = actor.kind === "admin" ? null : actor.id;
        for (const pid of [ord.customer_id, ord.rider_id, ord.merchant_id]) {
          if (pid && pid !== mine) notifyIds.push(String(pid));
        }
        // Primary peer: the party the caller is riding/delivering with.
        const peerId =
          mine === ord.customer_id ? ord.rider_id : mine === ord.rider_id ? ord.customer_id : ord.rider_id || ord.customer_id;
        if (peerId) {
          if (peerId === ord.rider_id) {
            peerPhone = (ord as { rider_phone?: string | null }).rider_phone || null;
            if (!peerPhone) {
              const { data: r } = await sb.from("riders").select("phone, name").eq("id", peerId).maybeSingle();
              peerPhone = (r as { phone?: string | null } | null)?.phone || null;
              peerName = (r as { name?: string | null } | null)?.name || "your rider";
            } else peerName = "your rider";
          } else {
            peerPhone = (ord as { customer_phone?: string | null }).customer_phone || null;
            peerName = "your customer";
          }
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
    peerPhone,
    peerName,
    // In-app share link removed — the server already alerted the other party
    // with the caller's coordinates. The client shows an in-app "Call" action
    // instead of dumping the user onto Google Maps.
    shareUrl: null,
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
