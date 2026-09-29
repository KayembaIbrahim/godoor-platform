import { NextResponse } from "next/server";
import { z } from "zod";
import { releaseEscrow } from "@/lib/escrow";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

const ConfirmSchema = z.object({
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

  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid orderId required" }, { status: 400 });
  }

  const { data: order } = await sb.from("orders").select("*").eq("id", parsed.data.orderId).maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const isRider = actor.kind === "user" && order.rider_id === actor.id;
  const isBusiness = actor.kind === "user" && order.merchant_id === actor.id;
  const isAdmin = actor.kind === "admin";
  if (!isRider && !isBusiness && !isAdmin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // release_escrow computes and writes the authoritative split in one
    // transaction, so these values are reported from the function result
    // rather than re-read from the order row.
    const result = await releaseEscrow(sb, parsed.data.orderId);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    const totalPlatformFees = result.customerFee + result.businessFee + result.riderFee;
    await sb.from("orders").update({
      status: "delivered",
      payment_status: "released",
    }).eq("id", parsed.data.orderId);
    return NextResponse.json({
      ok: true,
      feeBreakdown: {
        customerServiceFee: result.customerFee,
        businessServiceFee: result.businessFee,
        riderServiceFee: result.riderFee,
        merchantPayout: result.merchantPayout,
        riderPayout: result.riderPayout,
        totalPlatformFees,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not release escrow" },
      { status: 500 },
    );
  }
}
