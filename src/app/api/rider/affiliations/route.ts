import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { ensureMerchantRiders } from "@/lib/ensure-rider-team";

type MemberRow = { merchant_id: string; status: string; rate_ugx: number; created_at: string };

/** GET — the caller's fleet memberships + pending invites (merchant names included). */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in as a rider to continue" }, { status: 401 });

  await ensureMerchantRiders(sb);

  const { data: rows, error } = await sb
    .from("merchant_riders")
    .select("*, merchants(name, category)")
    .eq("rider_id", actor.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const memberships = (rows || []).map((r) => {
    const m = r as MemberRow & { merchants?: { name?: string; category?: string } };
    return {
      merchant_id: m.merchant_id,
      merchant_name: m.merchants?.name || "Store",
      category: m.merchants?.category || "",
      status: m.status,
      rate_ugx: Number(m.rate_ugx || 0),
      created_at: m.created_at,
    };
  });

  const active = memberships.find((m) => m.status === "active") || null;
  const invites = memberships.filter((m) => m.status === "invited");

  return NextResponse.json({ memberships, active, invites });
}

/** POST { merchant_id, action: 'accept' | 'decline' } — respond to a store's invitation. */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in as a rider to continue" }, { status: 401 });

  await ensureMerchantRiders(sb);

  const body = await req.json().catch(() => ({}));
  const merchantId = typeof body.merchant_id === "string" ? body.merchant_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!merchantId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "merchant_id and action (accept|decline) required" }, { status: 400 });
  }

  const { data: membership } = await sb
    .from("merchant_riders")
    .select("status")
    .eq("merchant_id", merchantId)
    .eq("rider_id", actor.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "You were not invited by this business." }, { status: 404 });
  }
  if (String((membership as { status: string }).status) !== "invited") {
    return NextResponse.json({ error: "This invitation is no longer pending." }, { status: 400 });
  }

  if (action === "accept") {
    // A rider can only serve one store's fleet — check no other active membership.
    const { data: otherActive } = await sb
      .from("merchant_riders")
      .select("merchant_id")
      .eq("rider_id", actor.id)
      .eq("status", "active")
      .neq("merchant_id", merchantId)
      .maybeSingle();
    if (otherActive) {
      return NextResponse.json({
        error: "You already belong to another business's fleet. Leave that store first to switch.",
      }, { status: 409 });
    }
  }

  const next = action === "accept" ? "active" : "declined";
  const { data, error } = await sb
    .from("merchant_riders")
    .update({
      status: next,
      accepted_at: action === "accept" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("merchant_id", merchantId)
    .eq("rider_id", actor.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ membership: data, ok: true });
}