import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, getMerchantForUser, isUuid, type Actor } from "@/lib/api-auth";
import { ensureMerchantRiders } from "@/lib/ensure-rider-team";

type MemberRow = {
  merchant_id: string;
  rider_id: string;
  status: string;
  rate_ugx: number;
  created_at: string;
};

async function actorMerchant(sb: NonNullable<ReturnType<typeof getServiceClient>>, actor: Actor) {
  // Admin proxies pass the merchant explicitly; everyone else must own it.
  if (actor.kind !== "user") return null;
  return (await getMerchantForUser(sb, actor.id))?.id || null;
}

/** GET ?merchant_id= — the business's rider fleet (memberships + rider info + live status). */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  await ensureMerchantRiders(sb);

  const merchantId = req.nextUrl.searchParams.get("merchant_id") || "";
  if (!isUuid(merchantId)) return NextResponse.json({ riders: [] });
  const myMerchant = await actorMerchant(sb, actor);
  if (actor.kind !== "admin" && myMerchant !== merchantId) {
    return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
  }

  const { data: members, error } = await sb
    .from("merchant_riders")
    .select("*, riders(*)")
    .eq("merchant_id", merchantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const riderIds = (members || []).map((m) => String((m as MemberRow).rider_id));
  const activeOrders = new Map<string, string>();
  if (riderIds.length) {
    const { data: onJob } = await sb
      .from("orders")
      .select("rider_id")
      .in("rider_id", riderIds)
      .in("status", ["rider_assigned", "delivering"])
      .limit(100);
    for (const o of onJob || []) {
      const rid = String((o as { rider_id: string }).rider_id);
      if (rid && !activeOrders.has(rid)) activeOrders.set(rid, "delivering");
    }
  }

  const riders = (members || []).map((m) => {
    const r = (m as { riders?: Record<string, unknown> }).riders || {};
    return {
      rider_id: String((m as MemberRow).rider_id),
      status: (m as MemberRow).status,
      rate_ugx: Number((m as MemberRow).rate_ugx || 0),
      created_at: (m as MemberRow).created_at,
      rider: {
        name: String(r.name || "Rider"),
        phone: String(r.phone || ""),
        email: String(r.email || ""),
        vehicle_type: String(r.vehicle_type || "motorbike"),
        online: String(r.status || "") === "online",
        verified: Boolean(r.verified),
        rating: Number(r.rating || 0),
      },
      on_delivery: activeOrders.has(String((m as MemberRow).rider_id)),
    };
  });

  return NextResponse.json({ riders });
}

/** POST { merchant_id, email_or_phone } — invite a verified rider to join the fleet. */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  await ensureMerchantRiders(sb);

  const body = await req.json().catch(() => ({}));
  const merchantId = typeof body.merchant_id === "string" ? body.merchant_id : "";
  const contact = typeof body.email_or_phone === "string" ? body.email_or_phone.trim() : "";
  if (!isUuid(merchantId)) return NextResponse.json({ error: "A valid business is required" }, { status: 400 });
  if (!contact) return NextResponse.json({ error: "Enter the rider's phone or email" }, { status: 400 });

  const myMerchant = await actorMerchant(sb, actor);
  if (actor.kind !== "admin" && myMerchant !== merchantId) {
    return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
  }

  // Find the rider by phone or email.
  const contactLower = contact.toLowerCase();
  const { data: found } = await sb
    .from("riders")
    .select("id, name, phone, email, verified, status")
    .or(`phone.eq.${contact},email.eq.${contactLower}`)
    .limit(5);
  const rider = (found || []).find((r) => String(r.phone || "").toLowerCase() === contactLower || String(r.email || "").toLowerCase() === contactLower);
  if (!rider) {
    return NextResponse.json({
      error: "No rider found with that phone or email. The rider must register and get verified on GoDoor first.",
    }, { status: 404 });
  }
  if (!rider.verified) {
    return NextResponse.json({ error: `${rider.name || "This rider"} isn't verified yet — they must finish rider verification first.` }, { status: 400 });
  }

  // One active fleet per rider — refuse if they already belong to another store.
  const { data: otherActive } = await sb
    .from("merchant_riders")
    .select("merchant_id")
    .eq("rider_id", String(rider.id))
    .eq("status", "active")
    .maybeSingle();
  if (otherActive && String((otherActive as { merchant_id: string }).merchant_id) !== merchantId) {
    return NextResponse.json({ error: "That rider already belongs to another business's fleet." }, { status: 409 });
  }

  const { data: membership, error } = await sb
    .from("merchant_riders")
    .upsert(
      { merchant_id: merchantId, rider_id: String(rider.id), status: "invited", updated_at: new Date().toISOString() },
      { onConflict: "merchant_id,rider_id" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    rider: { rider_id: String(rider.id), name: String(rider.name || ""), phone: String(rider.phone || "") },
    membership,
    invite_sent: true,
  });
}

/** PATCH { merchant_id, rider_id, action: 'remove' | 'reinvite' | 'rate', rate_ugx? } */
export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  await ensureMerchantRiders(sb);

  const body = await req.json().catch(() => ({}));
  const merchantId = typeof body.merchant_id === "string" ? body.merchant_id : "";
  const riderId = typeof body.rider_id === "string" ? body.rider_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!isUuid(merchantId) || !isUuid(riderId)) return NextResponse.json({ error: "merchant_id and rider_id are required" }, { status: 400 });

  const myMerchant = await actorMerchant(sb, actor);
  if (actor.kind !== "admin" && myMerchant !== merchantId) {
    return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
  }

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (action === "remove") upd.status = "removed";
  else if (action === "reinvite") upd.status = "invited";
  else if (action === "rate") {
    const rate = Math.max(0, Math.floor(Number(body.rate_ugx) || 0));
    upd.rate_ugx = rate;
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("merchant_riders")
    .update(upd)
    .eq("merchant_id", merchantId)
    .eq("rider_id", riderId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That rider isn't in your fleet." }, { status: 404 });
  return NextResponse.json({ membership: data });
}