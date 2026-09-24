import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, isUuid } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";
import { DEFAULT_RATE_UGX, refreshRateUgx, usdtConfig } from "@/lib/momo";

/**
 * Morse payment requests — the business pushes a payment to the customer's
 * Morse tag instead of waiting for the customer to send first.
 *
 *   POST  /api/morse/request { orderId }
 *         Business "requests payment" in the Morse app using the customer's
 *         Morse tag; GoDoor records the request (fixed business tag, order
 *         reference, USD amount) so both sides can see it.
 *   GET   /api/morse/request?order_id=…
 *         The merchant owner or the customer can read the requests on an order.
 *   PATCH /api/morse/request { id, status: "paid" | "cancelled" }
 *         The merchant marks the Morse transfer received (or cancels).
 *
 * Disputes are simple because the money always lands on the business's FIXED
 * Morse tag with the order reference in the note — the ledger never moves.
 */
const CreateSchema = z.object({ orderId: z.string() });
const PatchSchema = z.object({
  id: z.string(),
  status: z.enum(["paid", "cancelled"]),
});

export async function POST(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success || !isUuid(parsed.data.orderId)) {
    return NextResponse.json({ error: "Valid order id required" }, { status: 400 });
  }

  const { data: order } = await sb.from("orders").select("*").eq("id", parsed.data.orderId).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Merchant owner only
  const { data: merchant } = await sb
    .from("merchants")
    .select("id, owner_id, morse_tag")
    .eq("id", order.merchant_id)
    .maybeSingle();
  if (!merchant) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (merchant.owner_id !== actor.id) {
    return NextResponse.json({ error: "This order does not belong to your business." }, { status: 403 });
  }

  const businessTag = String(merchant.morse_tag || "").trim();
  if (!businessTag) {
    return NextResponse.json(
      { error: { message: "Set your business Morse tag first — it is the fixed wallet every Morse payment lands on (Store Profile → Morse)." } },
      { status: 409 },
    );
  }

  // Customer's Morse tag — the request is addressed to it.
  const customerId = order.customer_id || null;
  let customerTag = "";
  let customerName = String(order.customer_name || "Customer");
  if (customerId) {
    const { data: prof } = await sb.from("profiles").select("morse_tag, name").eq("id", customerId).maybeSingle();
    customerTag = String(prof?.morse_tag || "").trim();
    if (prof?.name) customerName = String(prof.name);
  }
  if (!customerTag) {
    return NextResponse.json(
      { error: { message: "This customer hasn't confirmed a Morse tag yet, so you can't request a Morse payment. Ask them to confirm it in the GoDoor app." } },
      { status: 409 },
    );
  }

  // One active request per order.
  const { data: existing } = await sb
    .from("payment_requests")
    .select("*")
    .eq("order_id", parsed.data.orderId)
    .eq("status", "requested")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ data: existing, meta: { note: "An active Morse request already exists for this order." } });
  }

  await refreshRateUgx();
  const cfg = usdtConfig();
  const amountUsdt = Math.max(1, Math.ceil(Number(order.total_ugx || 0) / (cfg.rateUgx || DEFAULT_RATE_UGX)));
  const reference = `GD-${parsed.data.orderId.replace(/-/g, "").slice(0, 10)}`;

  const { data, error } = await sb
    .from("payment_requests")
    .insert({
      order_id: parsed.data.orderId,
      merchant_id: merchant.id,
      business_morse_tag: businessTag,
      customer_morse_tag: customerTag,
      customer_name: customerName,
      amount_usdt: amountUsdt,
      reference,
      status: "requested",
      note: `Request from ${merchant.morse_tag} to ${customerTag} — send ${amountUsdt} USD for order ${reference}`,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 400 });

  const instructions = [
    `Open the Morse app and choose "Request payment".`,
    `Enter the customer's Morse tag: ${customerTag}`,
    `Amount: ${amountUsdt} USD (Morse shows it as ≈ UGX ${Number(order.total_ugx).toLocaleString()} — the order total at ${cfg.rateUgx} UGX per USD).`,
    `Put ${reference} in the note so the payment is tied to this order.`,
    `When the customer approves, the money lands on your Morse wallet @${businessTag.replace(/^@/, "")}. Then mark it received here.`,
  ].join(" ");

  return NextResponse.json({
    data,
    instructions,
    rateUgx: cfg.rateUgx,
    handle: cfg.handle,
    meta: { note: "The money arrives on your fixed business Morse tag — GoDoor never redirects it, so disputes are easy to resolve." },
  });
}

async function isOrderParticipant(sb: any, actor: { id: string; email: string }, order: any): Promise<boolean> {
  const isCustomer = order?.customer_id === actor.id || order?.customer_email === actor.email;
  if (isCustomer) return true;
  const { data: m } = await sb.from("merchants").select("owner_id").eq("id", order?.merchant_id).maybeSingle();
  return Boolean(m && m.owner_id === actor.id);
}

export async function GET(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  // Merchant variant: fetch every request created by this business.
  const merchantId = req.nextUrl.searchParams.get("merchant_id") || "";
  if (merchantId) {
    if (!isUuid(merchantId)) return NextResponse.json({ requests: [] });
    const { data: m } = await sb.from("merchants").select("owner_id").eq("id", merchantId).maybeSingle();
    if (!m || m.owner_id !== actor.id) {
      return NextResponse.json({ error: "This merchant view is private" }, { status: 403 });
    }
    const { data } = await sb
      .from("payment_requests")
      .select("*")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false });
    return NextResponse.json({ requests: data || [] });
  }

  const orderId = req.nextUrl.searchParams.get("order_id") || "";
  if (!orderId || !isUuid(orderId)) return NextResponse.json({ requests: [] });

  const { data: order } = await sb.from("orders").select("id, customer_id, customer_email, merchant_id").eq("id", orderId).maybeSingle();
  if (!order || !(await isOrderParticipant(sb, actor, order))) {
    return NextResponse.json({ error: "You are not part of this order" }, { status: 403 });
  }

  const { data } = await sb.from("payment_requests").select("*").eq("order_id", orderId).order("created_at", { ascending: false });
  return NextResponse.json({ requests: data || [] });
}

export async function PATCH(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success || !isUuid(parsed.data.id)) {
    return NextResponse.json({ error: "Valid id and status (paid|cancelled) required" }, { status: 400 });
  }

  const { data: reqRow } = await sb.from("payment_requests").select("*").eq("id", parsed.data.id).maybeSingle();
  if (!reqRow) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const { data: merchant } = await sb.from("merchants").select("owner_id, morse_tag").eq("id", reqRow.merchant_id).maybeSingle();
  if (!merchant || merchant.owner_id !== actor.id) {
    return NextResponse.json({ error: "Only the business can settle its own Morse request" }, { status: 403 });
  }

  if (reqRow.status === "cancelled") {
    return NextResponse.json({ error: "This request was already cancelled" }, { status: 409 });
  }
  const nextStatus = parsed.data.status;
  const note = nextStatus === "paid"
    ? `Paid — ${merchant.morse_tag} received ${reqRow.amount_usdt} USD on Morse for ${reqRow.reference}.`
    : "Request cancelled by the business.";

  const { data, error } = await sb
    .from("payment_requests")
    .update({ status: nextStatus, note, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}