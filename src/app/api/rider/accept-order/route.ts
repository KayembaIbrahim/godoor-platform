import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";

// Verify + accept: the server checks the caller is the verified rider and
// then assigns the order atomically — the client cannot spoof the rider id.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { orderId, riderName, riderPhone } = body || {};
  if (!orderId || !isUuid(orderId)) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in as a rider to accept this delivery" }, { status: 401 });
  }

  // Step 1: the caller must have a verified rider record for their own account
  const { data: riderRow, error: riderErr } = await sb.from("riders").select("verified, status").eq("id", actor.id).maybeSingle();
  if (riderErr) return NextResponse.json({ error: riderErr.message }, { status: 500 });
  if (!riderRow) {
    return NextResponse.json({ error: "Finish rider registration before accepting deliveries." }, { status: 403 });
  }
  if (!riderRow.verified) {
    return NextResponse.json({ error: "You must be verified to accept orders. Upload your National ID and vehicle documents first." }, { status: 403 });
  }

  // Step 2: check the order is still available (not already taken)
  const { data: order, error: orderErr } = await sb.from("orders").select("status, rider_id, merchant_id").eq("id", orderId).maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if ((order as { status: string }).status === "rider_assigned" && (order as { rider_id: string | null }).rider_id) {
    return NextResponse.json({ error: "This order was already accepted by another rider" }, { status: 409 });
  }
  if (!["payment_confirmed", "preparing", "ready", "medicines_ready"].includes((order as { status: string }).status)) {
    return NextResponse.json({ error: "This order is no longer available" }, { status: 409 });
  }

  // Step 2a: store riders may only claim THEIR business's orders. Platform
  // riders (no active fleet) keep the full pool.
  try {
    const { data: affs } = await sb.from("merchant_riders").select("merchant_id").eq("rider_id", actor.id).eq("status", "active");
    const storeIds: string[] = (affs || []).map((a) => String((a as { merchant_id: string }).merchant_id));
    const orderMerchantId = String((order as { merchant_id: string | null }).merchant_id || "");
    if (storeIds.length > 0 && !storeIds.includes(orderMerchantId)) {
      return NextResponse.json({ error: "This order isn't from the store you deliver for." }, { status: 403 });
    }
  } catch {}

  // Step 2b: a rider delivers ONE order at a time — block accepting while one is active
  const { data: active } = await sb
    .from("orders")
    .select("id, status")
    .eq("rider_id", actor.id)
    .in("status", ["rider_assigned", "delivering"])
    .limit(1)
    .maybeSingle();
  if (active) {
    return NextResponse.json(
      { error: "You already have an active delivery — finish it before accepting another." },
      { status: 409 },
    );
  }

  // Step 3: atomically claim the order (guarded status prevents double-assign)
  const { data: claimed, error: updateErr } = await sb
    .from("orders")
    .update({
      status: "rider_assigned",
      rider_id: actor.id,
      rider_name: String(riderName || ""),
      rider_phone: String(riderPhone || ""),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("status", (order as { status: string }).status) // optimistic concurrency guard
    .select("id")
    .maybeSingle();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  if (!claimed) return NextResponse.json({ error: "This order was just taken by another rider" }, { status: 409 });
  return NextResponse.json({ ok: true });
}