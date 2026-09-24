import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { creditWallet, setTopupStatus } from "@/lib/wallet-store";
import { verifyWebhookSignature } from "@/lib/momo";

/**
 * POST /api/momo/webhook — provider-confirmed top-up settlement.
 *
 * Only signed provider callbacks can credit wallets. Browser calls are never
 * trusted. Idempotent: a reference credits at most once (pending → credited).
 *
 * Flutterwave: set the webhook secret hash to FLUTTERWAVE_SECRET_KEY and point
 * the webhook URL at this route. Pesapal: register this URL as the IPN target.
 */
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  if (!(await verifyWebhookSignature(req, raw))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // Normalize across providers: flutterwave { txRef/tx_ref, amount, status },
  // pesapal IPN { OrderMerchantReference, OrderAmount }, generic { reference }.
  const data = (body.data as Record<string, unknown> | undefined) || body;
  const reference = String(
    data.txRef || data.tx_ref || data.merchant_reference || data.OrderMerchantReference || data.reference || "",
  ).trim();
  const status = String(data.status || data.payment_status || body.status || "").toLowerCase();
  const amountUgx = Number(data.amount || data.OrderAmount || data.amountUgx || 0);

  const paid =
    status === "successful" ||
    status === "success" ||
    status === "completed" ||
    status === "confirmed" ||
    status === "completedSuccessfully";

  if (!reference || !paid || !(amountUgx > 0)) {
    // Acknowledge non-payment events without crediting.
    return NextResponse.json({ ok: true, credited: false });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const { data: reqRow } = await sb
    .from("topup_requests")
    .select("*")
    .eq("reference", reference)
    .eq("status", "pending")
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ ok: true, credited: false, note: "already settled or unknown" });

  const row = reqRow as {
    id: string;
    user_id: string;
    amount_ugx: number;
    phone: string;
    network: string;
    currency: string;
  };
  // Provider amount must cover the requested amount (tolerate fees rounding).
  if (amountUgx + 1 < Number(row.amount_ugx)) {
    return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
  }

  try {
    await creditWallet(sb, String(row.user_id), {
      amountUgx: Number(row.amount_ugx),
      reference,
      currency: String(row.currency) === "USDT" ? "USDT" : "UGX",
      phone: String(row.phone || ""),
      network: String(row.network || ""),
      note: `MoMo top-up ${reference} confirmed by provider`,
      relatedId: String(row.id),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Credit failed" },
      { status: 500 },
    );
  }
  await setTopupStatus(sb, String(row.id), "credited", "provider-webhook", "Confirmed by provider webhook");
  return NextResponse.json({ ok: true, credited: true, reference });
}
