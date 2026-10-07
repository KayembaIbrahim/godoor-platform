import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
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
    .from("deposits")
    .select("*")
    .eq("reference_code", reference)
    .eq("status", "pending")
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ ok: true, credited: false, note: "already settled or unknown" });

  const row = reqRow as {
    id: string;
    user_id: string;
    amount: number;
    currency: string;
    provider_ref: string | null;
  };
  // Provider amount must cover the requested amount (tolerate fees rounding).
  if (amountUgx + 1 < Number(row.amount)) {
    return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
  }

  // Settle and pay inside one transaction. The previous flow credited the
  // wallet and only then marked the request settled, so a provider retry after
  // a failure paid the same reference twice.
  // NOTE: must not be named `data` — `data` is already declared at the top of
  // this handler (the normalized provider payload). Redeclaring it in the same
  // block is TS2451 and a hard SyntaxError once compiled, so this binding is
  // deliberately distinct. Semantics are unchanged: `data` below is unused.
  const { data: rpcData, error } = await sb.rpc("credit_deposit", {
    p_deposit_id: row.id,
    p_note: `MoMo top-up ${reference} confirmed by provider`,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as { success?: boolean; message?: string } | null;
  if (!result || result.success !== true) {
    return NextResponse.json({ ok: true, credited: false, note: result?.message || "not settled" });
  }

  const { error: refError } = await sb
    .from("deposits")
    .update({ provider_ref: row.provider_ref || reference })
    .eq("id", row.id);
  if (refError) {
    return NextResponse.json({ error: "Could not record provider reference" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, credited: true, reference });
}
