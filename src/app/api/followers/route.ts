import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ followers: [], count: 0, isFollowing: false });

  const merchantId = req.nextUrl.searchParams.get("merchant_id");

  if (merchantId) {
    if (!isUuid(merchantId)) return NextResponse.json({ followers: [], count: 0, isFollowing: false });
    const { data } = await sb.from("followers").select("customer_id").eq("merchant_id", merchantId);
    const count = data?.length || 0;
    // isFollowing is only meaningful when a signed-in customer asks.
    const actor = await authorize(req);
    const isFollowing = actor?.kind === "user"
      ? !!data?.some((f) => f.customer_id === actor.id)
      : false;
    return NextResponse.json({ followers: data || [], count, isFollowing });
  }
  return NextResponse.json({ followers: [], count: 0, isFollowing: false });
}

// POST — follow/unfollow only ever acts on YOUR OWN customer_id.
export async function POST(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  const body = await req.json();
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const merchantId = body.merchant_id;
  if (!isUuid(merchantId)) {
    return NextResponse.json({ error: "A valid business is required" }, { status: 400 });
  }

  if (body.action === "unfollow") {
    await sb.from("followers").delete()
      .eq("customer_id", actor.id)
      .eq("merchant_id", merchantId);
    return NextResponse.json({ isFollowing: false });
  }

  const { data: merchant } = await sb.from("merchants").select("id").eq("id", merchantId).maybeSingle();
  if (!merchant) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const { error } = await sb.from("followers").upsert({
    customer_id: actor.id,
    merchant_id: merchantId,
  }, { onConflict: "customer_id,merchant_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ isFollowing: true });
}