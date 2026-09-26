import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { computeOrderFinancials } from "@/lib/utils";
import { refreshRateUgx } from "@/lib/momo";

/**
 * POST /api/orders/financials
 *
 * Server-side financial breakdown for an order before the customer pays.
 * Returns the exact amount the customer must send via Morse, the merchant's
 * net payout after the 15% commission, and the unique payment reference.
 */
export async function POST(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { subtotalUgx, deliveryFeeUgx, orderId, riderPayoutUgx } = body || {};

  if (!subtotalUgx || !orderId) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "subtotalUgx and orderId required" } },
      { status: 400 }
    );
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  // Verify the order belongs to this customer
  const { data: order } = await sb
    .from("orders")
    .select("customer_id, customer_email")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || (order.customer_id !== actor.id && order.customer_email !== actor.email)) {
    return NextResponse.json({ error: "Order not found or access denied" }, { status: 404 });
  }

  await refreshRateUgx();

  const riderPayout = riderPayoutUgx != null && riderPayoutUgx !== "" ? Number(riderPayoutUgx) : undefined;

  const financials = computeOrderFinancials({
    subtotalUgx: Number(subtotalUgx),
    deliveryFeeUgx: Number(deliveryFeeUgx) || 0,
    riderPayoutUgx: riderPayout,
    orderId,
  });

  return NextResponse.json({
    data: {
      ...financials,
      customerAmountLabel: `UGX ${financials.totalCustomerPaysUgx.toLocaleString("en-UG")}`,
      merchantNetLabel: `UGX ${financials.merchantPayoutUgx.toLocaleString("en-UG")}`,
      commissionLabel: `UGX ${financials.platformFeeUgx.toLocaleString("en-UG")} (${(financials.commissionRate * 100).toFixed(0)}% fee)`,
      paymentReference: financials.paymentReference,
      instruction: `Send UGX ${financials.totalCustomerPaysUgx.toLocaleString("en-UG")} to GoDoor via Morse. Reference: ${financials.paymentReference}`,
    },
  });
}
