import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid, resolveMerchantWriteAccess } from "@/lib/api-auth";
import { autoCloseIfMoving } from "@/lib/stopover-server";

const TABLE_SCHEMA: Record<string, { allowed: string[] }> = {
  payments:      { allowed: ["order_id", "merchant_id", "amount_ugx", "method", "screenshot_url", "transaction_ref", "status", "submitted_by", "note"] },
  chat_messages: { allowed: ["order_id", "sender_id", "sender_name", "sender_role", "text", "read", "image_url"] },
  products:      { allowed: ["merchant_id", "name", "description", "price_ugx", "category", "image_url", "available", "sort_order", "images", "bulky"] },
  merchants:     { allowed: ["name", "category", "tagline", "area", "district", "lat", "lng", "momo_number", "momo_name", "opens_at", "closes_at", "delivery_fee_ugx", "rating", "status", "logo_url", "shop_photo_url", "phone", "live_location_enabled"] },
  riders:        { allowed: ["name", "email", "phone", "vehicle_type", "plate", "service_area", "lat", "lng", "status", "verified"] },
  follows:       { allowed: ["customer_id", "merchant_id"] },
  stories:       { allowed: ["merchant_id", "merchant_name", "media_url", "caption", "type", "expires_at"] },
};

/**
 * Tell the customer their wait clock stopped and what it added.
 *
 * Best-effort, like every other push here: a missing notification must never
 * fail the location broadcast that riders and dispatch depend on.
 */
async function notifyStopoverClosed(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  rideId: string,
  minutes: number,
  chargeUgx: number,
): Promise<void> {
  try {
    const { data } = await sb.from("ride_requests").select("customer_id").eq("id", rideId).maybeSingle();
    const customerId = (data as Record<string, unknown> | null)?.customer_id as string | null;
    if (!customerId) return;
    const { pushToUser } = await import("@/lib/web-push-server");
    await pushToUser(sb, customerId, {
      title: "Your rider is on the way again",
      body:
        chargeUgx > 0
          ? `Wait of ${Math.round(minutes)} min added UGX ${chargeUgx.toLocaleString("en-US")} to your fare.`
          : "The wait ended within your free waiting time — no extra charge.",
      url: `/ride?rideId=${rideId}`,
      tag: `ride-${rideId}`,
    });
  } catch {
    // Push is a convenience, never a dependency.
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { table, id, patch } = body;
  if (typeof table !== "string" || typeof id !== "string" || !patch) {
    return NextResponse.json({ error: "table, id, patch required" }, { status: 400 });
  }
  const schema = TABLE_SCHEMA[table];
  if (!schema) return NextResponse.json({ error: "Unknown table" }, { status: 400 });
  if (!isUuid(id)) return NextResponse.json({ ok: true });

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  // Non-admin callers must not touch moderation / ownership fields
  if (actor.kind === "user") {
    if (table === "merchants" && (patch.rating !== undefined || patch.status !== undefined || patch.owner_id !== undefined)) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    if (table === "riders" && (patch.verified !== undefined)) {
      return NextResponse.json({ error: "Only an admin can verify riders" }, { status: 403 });
    }
    if (table === "payments") {
      const { data: pay } = await sb.from("payments").select("submitted_by").eq("id", id).maybeSingle();
      if (!pay || (pay as { submitted_by: string }).submitted_by !== actor.id) {
        return NextResponse.json({ error: "You cannot modify this payment" }, { status: 403 });
      }
    }
    if (table === "chat_messages" && patch.sender_id !== undefined && patch.sender_id !== actor.id) {
      return NextResponse.json({ error: "You cannot post as another user" }, { status: 403 });
    }
    // Merchandise & catalogs may only be edited by the owning merchant.
    if (table === "products") {
      const { data: prod } = await sb.from("products").select("merchant_id").eq("id", id).maybeSingle();
      if (!prod) return NextResponse.json({ error: "Product not found" }, { status: 404 });
      const access = await resolveMerchantWriteAccess(sb, String((prod as { merchant_id: string }).merchant_id), actor.id);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
    }
    if (table === "stories") {
      const { data: story } = await sb.from("stories").select("merchant_id").eq("id", id).maybeSingle();
      if (story) {
        const access = await resolveMerchantWriteAccess(sb, String((story as { merchant_id: string }).merchant_id), actor.id);
        if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
      }
    }
    if (table === "merchants") {
      const access = await resolveMerchantWriteAccess(sb, id, actor.id);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
    }
  }

  // riders and chat_messages have no updated_at column — skip it for them
  const upd: Record<string, unknown> = table === "riders" || table === "chat_messages" ? {} : { updated_at: new Date().toISOString() };
  for (const k of schema.allowed) {
    if (k in patch) {
      let v = (patch as any)[k];
      if (["order_id", "merchant_id", "customer_id", "sender_id"].includes(k)) v = isUuid(v) ? v : null;
      upd[k] = v;
    }
  }

  const { error } = await sb.from(table).update(upd).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { table, data, action } = body;

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  // Action flows (live location broadcasts) don't use the table insert shape.
  if (action === "upsertRiderLocation") {
    const { lat, lng, heading, speed, accuracy } = body;
    // Only the rider themselves (or admin) may post their live location
    const riderId = actor.kind === "user" ? actor.id : (isUuid(body.rider_id) ? body.rider_id : null);
    if (!riderId) return NextResponse.json({ error: "Sign in to broadcast your location" }, { status: 401 });
    try {
      const { error: locErr } = await sb.from("rider_locations").upsert({
        rider_id: riderId,
        lat: Number(lat || 0),
        lng: Number(lng || 0),
        heading: Number(heading || 0),
        speed: Number(speed || 0),
        accuracy: Number(accuracy || 0),
        updated_at: new Date().toISOString(),
      }, { onConflict: "rider_id" });
      if (locErr) {
        console.error("rider_locations upsert failed:", locErr.message);
        await sb.from("riders").update({ lat: Number(lat || 0), lng: Number(lng || 0) }).eq("id", riderId);
      }
    } catch (e) { console.error("rider location upsert crashed:", e); }

    /* Stopover is now DECLARED by the rider, not inferred from slowness. This
       ping no longer adds time to the bill — it only does the opposite job: if
       the rider started a wait and then set off again, the open stopover is
       closed automatically.

       Without that, a rider could tap "waiting on customer", start the engine
       and keep billing for the rest of the evening. Auto-close on movement is
       what makes the button trustworthy, so it runs on every ping.

       UNIT: `body.speed` is `position.coords.speed`, which the Geolocation API
       defines in METRES PER SECOND. The threshold below is in km/h, so the
       conversion is not optional — feeding m/s straight in made a rider doing
       4 m/s (14 km/h, clearly driving) read as 4 km/h and escape the auto-close
       entirely, which silently disabled the anti-fraud control. */
    try {
      const speedMs = Number(speed || 0);
      const closed = await autoCloseIfMoving(sb, riderId, speedMs * 3.6);
      if (closed && closed.minutes > 0) {
        // Tell the customer the clock stopped, so the figure stops climbing.
        await notifyStopoverClosed(sb, closed.rideId, closed.minutes, closed.chargeUgx);
      }
    } catch (e) {
      console.error("stopover auto-close failed:", e);
    }
    return NextResponse.json({ ok: true });
  }

  // Traveling businesses share their live position — only while their store
  // has live sharing enabled, and only by the store owner.
  if (action === "upsertProviderLocation" || action === "clearProviderLocation") {
    const merchantId = isUuid(body.merchant_id) ? body.merchant_id : null;
    if (!merchantId) return NextResponse.json({ error: "Business id required" }, { status: 400 });

    const access: { ok: true } | { ok: false; error: string } = actor.kind === "user"
      ? await resolveMerchantWriteAccess(sb, merchantId, actor.id)
      : { ok: true };
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

    if (action === "clearProviderLocation") {
      await sb.from("provider_locations").delete().eq("provider_id", merchantId);
      return NextResponse.json({ ok: true });
    }

    // Only stream when sharing is actually turned on (server-authoritative).
    const { data: merchant } = await sb.from("merchants").select("live_location_enabled").eq("id", merchantId).maybeSingle();
    if (!merchant || !(merchant as { live_location_enabled?: boolean }).live_location_enabled) {
      return NextResponse.json({ ok: false, error: "Live location sharing is off for this business" }, { status: 403 });
    }

    const { error: locErr } = await sb.from("provider_locations").upsert({
      provider_id: merchantId,
      lat: Number(body.lat || 0),
      lng: Number(body.lng || 0),
      heading: Number(body.heading || 0),
      speed: Number(body.speed || 0),
      accuracy: Number(body.accuracy || 0),
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider_id" });
    if (locErr) console.error("provider_locations upsert failed:", locErr.message);
    return NextResponse.json({ ok: true });
  }

  if (typeof table !== "string" || !data || typeof data !== "object") {
    return NextResponse.json({ error: "table and data required" }, { status: 400 });
  }
  const schema = TABLE_SCHEMA[table];
  if (!schema) return NextResponse.json({ error: "Unknown table" }, { status: 400 });

  const insert: Record<string, unknown> = {};
  for (const k of schema.allowed) {
    if (k in data) {
      let v = (data as any)[k];
      if (["order_id", "merchant_id", "customer_id", "sender_id"].includes(k)) v = isUuid(v) ? v : null;
      insert[k] = v;
    }
  }
  if (data.id && isUuid(data.id)) insert.id = data.id;

  // Identity is never client-chosen for non-admin writers
  if (actor.kind === "user") {
    if (table === "payments") insert.submitted_by = actor.id;
    if (table === "chat_messages") {
      insert.sender_id = actor.id;
      insert.sender_role = actor.role || insert.sender_role || "customer";
    }
    if (table === "follows") {
      insert.customer_id = actor.id;
    }
    if (table === "riders") insert.verified = false;

    // Merchant-owned content requires ownership of the referenced store.
    if (table === "products" && insert.merchant_id) {
      const access = await resolveMerchantWriteAccess(sb, String(insert.merchant_id), actor.id);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
    }
    if (table === "stories" && insert.merchant_id) {
      const access = await resolveMerchantWriteAccess(sb, String(insert.merchant_id), actor.id);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
    }
    if (table === "merchants") {
      // Only business/admin accounts may open stores, and never as "active".
      if (actor.role !== "business" && actor.role !== "admin") {
        return NextResponse.json({ error: "Only business accounts can create a store." }, { status: 403 });
      }
      insert.owner_id = actor.id;
      insert.status = "pending";
      insert.verified = false;
    }
  }

  if (Object.keys(insert).length === 0) return NextResponse.json({ ok: true });

  const { data: result, error } = await sb.from(table).insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: result });
}