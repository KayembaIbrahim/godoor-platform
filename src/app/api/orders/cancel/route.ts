import { NextResponse } from "next/server";
import { z } from "zod";
import { refundEscrow } from "@/lib/escrow";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

const CancelSchema = z.object({
  orderId: z.string().uuid(),
});

export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor) {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid orderId required" }, { status: 400 });
  }

  const { data: order } = await sb.from("orders").select("*").eq("id", parsed.data.orderId).maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const isCustomer = actor.kind === "user" && order.customer_id === actor.id;
  const isBusiness = actor.kind === "user" && order.merchant_id === actor.id;
  const isAdmin = actor.kind === "admin";
  if (!isCustomer && !isBusiness && !isAdmin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (!["pending", "payment_confirmed", "preparing", "ready", "rider_assigned"].includes(order.status)) {
    return NextResponse.json({ error: "Order cannot be cancelled at this stage" }, { status: 400 });
  }

  try {
    const result = await refundEscrow(sb, parsed.data.orderId);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    await sb.from("orders").update({
      status: "cancelled",
      payment_status: "refunded",
    }).eq("id", parsed.data.orderId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not refund escrow" },
      { status: 500 },
    );
  }
}
