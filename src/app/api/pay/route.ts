import { NextResponse } from "next/server";
import { z } from "zod";
import { debitGasFee, snapshotWallet } from "@/lib/wallet-store";
import { newId } from "@/lib/utils";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";
import { refreshRateUgx, usdtConfig } from "@/lib/momo";

const PaySchema = z.object({
  amountUgx: z.coerce.number().int().positive().max(10_000_000),
  note: z.string().min(1).max(200).optional().default("GoDoor order"),
  orderRef: z.string().optional(),
});

/**
 * Pay for any GoDoor service from the caller's wallet balance.
 * Server-side only — balances live server-side and the actor's identity is
 * always taken from the verified session, never from the client.
 */
export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Invalid payment request" } },
      { status: 400 },
    );
  }

  // If charging for a specific order, that order must belong to this customer.
  if (parsed.data.orderRef && isUuid(parsed.data.orderRef)) {
    const sb = getServiceClient();
    if (sb) {
      const { data: order } = await sb
        .from("orders")
        .select("customer_id, customer_email")
        .eq("id", parsed.data.orderRef)
        .maybeSingle();
      if (order && order.customer_id !== actor.id && order.customer_email !== actor.email) {
        return NextResponse.json({ error: "You cannot pay for another customer's order." }, { status: 403 });
      }
    }
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  await refreshRateUgx();
  const rateUgx = usdtConfig().rateUgx;
  const before = await snapshotWallet(sb, actor.id);
  const gasUgx = before.availableUgx + before.availableUsdt * rateUgx;
  if (gasUgx < parsed.data.amountUgx) {
    return NextResponse.json(
      {
        error: {
          code: "INSUFFICIENT",
          message: "Not enough GoDoor gas fee. Top up from your Morse wallet, or pay cash / mobile money.",
          availableUgx: gasUgx,
          requiredUgx: parsed.data.amountUgx,
        },
      },
      { status: 402 },
    );
  }

  try {
    const wallet = await debitGasFee(sb, actor.id, {
      amountUgx: parsed.data.amountUgx,
      reference: parsed.data.orderRef || newId("ord"),
      note: parsed.data.note,
      rateUgx,
    });
    return NextResponse.json({
      data: {
        paid: true,
        wallet,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: "PAY_FAILED",
          message: e instanceof Error ? e.message : "Payment failed",
        },
      },
      { status: 400 },
    );
  }
}