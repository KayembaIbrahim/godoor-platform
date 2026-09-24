import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import {
  authorize, canTransition, getMerchantForUser, isKnownStatus, isUuid,
} from "@/lib/api-auth";
import { debitGasFee, snapshotWallet } from "@/lib/wallet-store";
import { refreshRateUgx, usdtConfig } from "@/lib/momo";
import { ensureClinicOrderSchema } from "@/lib/ensure-clinic";

const ENSURE_SCHEDULE_COLUMN = `ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;`;

async function ensureScheduleColumn(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: ENSURE_SCHEDULE_COLUMN }); } catch {}
}

/**
 * Order API — every request is authenticated (admin cookie or Supabase JWT).
 * Writes are authorized per role and the order status machine is enforced
 * server-side.
 */

type OrderRow = {
  id: string;
  status: string;
  merchant_id: string | null;
  rider_id: string | null;
  customer_id: string | null;
  customer_email: string | null;
};

async function unauthorized(): Promise<NextResponse> {
  return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return unauthorized();
  if (actor.kind === "admin") {
    // Admin listing — any order (admin dashboard uses /api/admin/orders, but
    // this path is also used by the shared db layer).
    const { searchParams } = new URL(req.url);
    if (searchParams.get("id")) {
      const { data: single } = await sb.from("orders").select("*").eq("id", searchParams.get("id")).maybeSingle();
      return NextResponse.json({ orders: single ? [single] : [] });
    }
    let q = sb.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
    if (searchParams.get("merchant_id")) q = q.eq("merchant_id", searchParams.get("merchant_id"));
    if (searchParams.get("customer_id")) q = q.eq("customer_id", searchParams.get("customer_id"));
    if (searchParams.get("status")) q = q.eq("status", searchParams.get("status"));
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data || [] });
  }

  const user = actor;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const customerId = searchParams.get("customer_id");
  const customerEmail = searchParams.get("customer_email");
  const merchantId = searchParams.get("merchant_id");
  const status = searchParams.get("status");

  // Single-order lookup (tracking page) — must belong to the caller
  if (id) {
    const { data: single, error: singleErr } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
    if (singleErr) return NextResponse.json({ error: singleErr.message }, { status: 500 });
    if (!single) return NextResponse.json({ orders: [] });
    const o = single as OrderRow;
    const merchantIdOfCaller = (await getMerchantForUser(sb, user.id))?.id || null;
    const owns =
      o.customer_id === user.id ||
      o.customer_email === user.email ||
      (!!merchantIdOfCaller && o.merchant_id === merchantIdOfCaller) ||
      o.rider_id === user.id;
    if (!owns) return NextResponse.json({ orders: [] }, { status: 404 });
    return NextResponse.json({ orders: [single] });
  }

  // Merchant dashboard scoping — caller must own the requested store (legacy
  // un-owned stores remain accessible to any editor until claimed on first write)
  if (merchantId) {
    if (!isUuid(merchantId)) return NextResponse.json({ orders: [] });
    const { data: merchant, error: merErr } = await sb.from("merchants").select("owner_id").eq("id", merchantId).maybeSingle();
    if (merErr) return NextResponse.json({ orders: [] });
    if (!merchant) return NextResponse.json({ orders: [] });
    const ownerId = (merchant as { owner_id: string | null }).owner_id;
    if (ownerId && ownerId !== user.id) {
      return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
    }
  }
  // Customer scoping — caller may only read their own orders
  if (customerId && customerId !== user.id) {
    return NextResponse.json({ error: "You cannot view another customer's orders." }, { status: 403 });
  }

  let query = sb.from("orders").select("*").order("created_at", { ascending: false }).limit(500);
  if (merchantId) query = query.eq("merchant_id", merchantId);
  if (customerId) query = query.eq("customer_id", customerId);
  if (customerEmail) query = query.eq("customer_email", customerEmail);
  if (status) query = query.eq("status", status);

  // Unfiltered listing is never the whole table. Every signed-in user keeps
  // their full order history across every role they take part in:
  //   - orders they placed as a customer
  //   - orders for merchants they own (business)
  //   - deliveries assigned to them, plus open dispatchable jobs (rider)
  if (!merchantId && !customerId && !customerEmail && !status) {
    const merged = new Map<string, unknown>();
    const stamp = (r: unknown) => new Date((r as { created_at: string }).created_at || 0).getTime();

    const { data: customerOrders } = await sb
      .from("orders").select("*").order("created_at", { ascending: false }).limit(500)
      .or(`customer_id.eq.${user.id},customer_email.eq.${user.email}`);
    for (const o of customerOrders || []) merged.set(String((o as { id: string }).id), o);

    const { data: owned, error: ownedErr } = await sb.from("merchants").select("id").eq("owner_id", user.id);
    if (!ownedErr) {
      for (const m of owned || []) {
        const { data: rows } = await sb.from("orders").select("*").order("created_at", { ascending: false }).eq("merchant_id", String((m as { id: string }).id)).limit(500);
        for (const o of rows || []) merged.set(String((o as { id: string }).id), o);
      }
    }

    const { data: riderRow } = await sb.from("riders").select("id").eq("id", user.id).maybeSingle();
    if (riderRow) {
      // Store riders (business-owned fleets) see ONLY their store's open jobs.
      // Platform riders (no fleet) keep the full dispatch pool.
      let storeFilter = "";
      try {
        const { data: affs } = await sb.from("merchant_riders").select("merchant_id").eq("rider_id", user.id).eq("status", "active");
        const storeIds: string[] = (affs || []).map((a) => String((a as { merchant_id: string }).merchant_id));
        if (storeIds.length) storeFilter = `,and(rider_id.is.null,status.in.(payment_confirmed,preparing,ready,medicines_ready),merchant_id.in.(${storeIds.join(",")}))`;
      } catch {}
      const { data: riderOrders } = await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(500)
        .or(`rider_id.eq.${user.id}${storeFilter || ",and(rider_id.is.null,status.in.(payment_confirmed,preparing,ready,medicines_ready))"}`);
      for (const o of riderOrders || []) merged.set(String((o as { id: string }).id), o);
    }

    const sorted = [...merged.values()].sort((a, b) => stamp(b) - stamp(a)).slice(0, 500);
    return NextResponse.json({ orders: sorted });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data || [] });
}

export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const { id, patch } = body;
  if (typeof id !== "string" || !patch || typeof patch !== "object") {
    return NextResponse.json({ error: "id and patch required" }, { status: 400 });
  }
  const nextStatus: string | null = typeof patch.status === "string" ? patch.status : null;
  // Self-heal the extended CHECK before any status transition so 'ready' (and future) statuses never violate the constraint
  if (nextStatus) await ensureClinicOrderSchema(sb);
  if (!isUuid(id)) {
    return NextResponse.json({ ok: true }); // local-only order
  }

  const { data: orderRow, error: fetchErr } = await sb.from("orders").select("id, status, merchant_id, rider_id, customer_id, customer_email").eq("id", id).maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!orderRow) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = orderRow as OrderRow;
  const riderIdPatch: string | null = typeof patch.rider_id === "string" ? patch.rider_id : null;
  const paymentConfirmedPatch = patch.payment_confirmed !== undefined ? Boolean(patch.payment_confirmed) : undefined;
  const msg = patch.notes !== undefined ? String(patch.notes) : undefined;

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const ALLOWED = new Set([
    "status", "notes", "rider_id", "rider_name", "rider_phone", "payment_confirmed",
    "medicine_paid",
  ]);
  for (const k of ALLOWED) {
    if (k in patch) upd[k] = (patch as any)[k];
  }

  if (actor.kind === "admin") {
    if (upd.status !== undefined && !isKnownStatus(upd.status)) {
      return NextResponse.json({ error: `Unknown status "${upd.status}"` }, { status: 400 });
    }
    const { error } = await sb.from("orders").update(upd).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const user = actor;
  const merchantIdOfCaller = (await getMerchantForUser(sb, user.id))?.id || null;
  const decision = canTransition({ order, user, merchantIdOfCaller }, nextStatus, {
    payment_confirmed_patch: paymentConfirmedPatch,
    riderIdPatch: riderIdPatch === user.id ? riderIdPatch : null,
    medicine_paid_patch: body.patch?.medicine_paid === true,
  });
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: 403 });

  const userUpd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (nextStatus) userUpd.status = nextStatus;
  if (riderIdPatch === user.id) {
    userUpd.rider_id = riderIdPatch;
    if (patch.rider_name) userUpd.rider_name = String(patch.rider_name);
    if (patch.rider_phone) userUpd.rider_phone = String(patch.rider_phone);
  }
  if (paymentConfirmedPatch !== undefined) userUpd.payment_confirmed = Boolean(paymentConfirmedPatch);
  if (body.patch?.medicine_paid === true) userUpd.medicine_paid = true;
  if (msg !== undefined && typeof msg === "string") userUpd.notes = msg;

  if (Object.keys(userUpd).length === 1) return NextResponse.json({ ok: true });

  const { error } = await sb.from("orders").update(userUpd).eq("id", id);
  if (error) {
    console.error("updateOrder API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Create a new order via server — customer identity is always forced and all
 *  amounts are recomputed server-side from the DB (never trusted from the client). */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const merchantId = body.merchant_id;
  if (!isUuid(merchantId)) {
    return NextResponse.json({ error: "A valid business is required to place an order" }, { status: 400 });
  }

  await ensureScheduleColumn(sb);

  // The merchant must exist and be active (no orders for vanished/suspended stores)
  const { data: merchant, error: merchantErr } = await sb
    .from("merchants")
    .select("id, name, status, delivery_fee_ugx")
    .eq("id", merchantId)
    .maybeSingle();
  if (merchantErr) return NextResponse.json({ error: merchantErr.message }, { status: 500 });
  if (!merchant) return NextResponse.json({ error: "This business is no longer available" }, { status: 400 });
  // Allow both active and pending businesses to receive orders — pending is auto-activated on first save
  // Only suspended businesses are blocked. This fixes the lazy bug where customers submit but business sees nothing.
  if (merchant.status === "suspended") {
    return NextResponse.json({ error: "This business is temporarily unavailable" }, { status: 400 });
  }
  // Auto-activate pending merchant on first successful order — ensures discoverability
  if (merchant.status === "pending") {
    try { await sb.from("merchants").update({ status: "active" }).eq("id", merchantId); } catch {}
  }

  const status = body.status === "pending" ? "pending" : "payment_submitted";
  const customerId = actor.kind === "admin" && isUuid(body.customer_id) ? body.customer_id : (actor.kind === "user" ? actor.id : null);
  if (!customerId) return NextResponse.json({ error: "Sign in to place an order" }, { status: 401 });

  // ── Server-authoritative pricing ─────────────────────────────────────────
  // Fees come from the fee_config row (fallback to constants), line-item prices
  // come from the products table for THIS merchant, and nothing financial is
  // taken from the request body.
  const DEFAULT_FEES = {
    delivery_fee_ugx: 2000,
    service_fee_percent: 5,
    service_fee_min_ugx: 0,
    service_fee_max_ugx: 10000,
    min_order_ugx: 3000,
    free_delivery_threshold_ugx: 25000,
  };
  let fees = { ...DEFAULT_FEES };
  try {
    const { data: f } = await sb.from("fee_config").select("*").eq("id", "default").single();
    if (f) {
      fees = {
        delivery_fee_ugx: Number(f.delivery_fee_ugx ?? DEFAULT_FEES.delivery_fee_ugx),
        service_fee_percent: Number(f.service_fee_percent ?? DEFAULT_FEES.service_fee_percent),
        service_fee_min_ugx: Number(f.service_fee_min_ugx ?? DEFAULT_FEES.service_fee_min_ugx),
        service_fee_max_ugx: Number(f.service_fee_max_ugx ?? DEFAULT_FEES.service_fee_max_ugx),
        min_order_ugx: Number(f.min_order_ugx ?? DEFAULT_FEES.min_order_ugx),
        free_delivery_threshold_ugx: Number(f.free_delivery_threshold_ugx ?? DEFAULT_FEES.free_delivery_threshold_ugx),
      };
    }
  } catch {}

  // Parse requested line items (only productId, quantity and bulky are taken from the client).
  const requested: Array<{ productId: string; quantity: number; bulky: boolean }> = Array.isArray(body.line_items)
    ? body.line_items.map((li: Record<string, unknown>) => ({
        productId: String(li.productId ?? ""),
        quantity: Math.max(1, Math.floor(Number(li.quantity) || 1)),
        bulky: Boolean(li.bulky),
      }))
    : [];
  const productIds = requested.map((li) => li.productId).filter(Boolean);
  if (productIds.length === 0) {
    return NextResponse.json({ error: "Your cart is empty" }, { status: 400 });
  }

  // Resolve every line item against the products table for this merchant.
  const prices = new Map<string, { price: number; name: string }>();
  for (let i = 0; i < productIds.length; i += 50) {
    const chunk = productIds.slice(i, i + 50);
    const { data: rows } = await sb
      .from("products")
      .select("id, name, price, available")
      .eq("merchant_id", merchantId)
      .in("id", chunk);
    for (const row of rows || []) prices.set(String(row.id), { price: Number(row.price ?? 0), name: String(row.name || "") });
  }

  const lineItems = requested.map((li) => {
    const p = prices.get(li.productId);
    return {
      productId: li.productId,
      merchantId,
      name: p ? p.name : "Item",
      unitPriceUgx: p ? p.price : 0,
      quantity: li.quantity,
      bulky: li.bulky,
    };
  });

  let subtotal = 0;
  for (const li of lineItems) subtotal += li.unitPriceUgx * li.quantity;

  if (subtotal <= 0) {
    return NextResponse.json({ error: "Your cart is empty" }, { status: 400 });
  }
  if (fees.min_order_ugx > 0 && subtotal < fees.min_order_ugx) {
    return NextResponse.json({ error: `Minimum order is UGX ${fees.min_order_ugx.toLocaleString()}` }, { status: 400 });
  }

  const deliveryFee = subtotal >= fees.free_delivery_threshold_ugx
    ? 0
    : Number(merchant.delivery_fee_ugx ?? fees.delivery_fee_ugx);
  const rawService = Math.round((subtotal * fees.service_fee_percent) / 100);
  const serviceFee = Math.min(fees.service_fee_max_ugx, Math.max(fees.service_fee_min_ugx, rawService));
  const totalUgx = subtotal + deliveryFee + serviceFee;

  const paymentMethod = typeof body.payment_method === "string" ? body.payment_method : "momo";

  // Delivery coordinates must be real — anything missing/out-of-range becomes
  // null (never the (0,0) ocean point) so maps and nav links can't lie.
  const validCoord = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const customerLat = validCoord(body.customer_lat, -1.5, 4.5);
  const customerLng = validCoord(body.customer_lng, 28, 36);

  // Clinic appointments may carry a requested time. Anything unparseable is
  // treated as "now" (ASAP).
  let scheduledFor: string | null = null;
  if (typeof body.scheduled_for === "string" && body.scheduled_for) {
    const t = new Date(body.scheduled_for).getTime();
    if (!Number.isNaN(t)) scheduledFor = new Date(t).toISOString();
  }

  // ── Gas fee (GoDoor balance) preflight ───────────────────────────────────
  // The free 2000 UGX signup bonus + Morse USDT top-ups form the gas-fee
  // balance. Paying the whole order from it is allowed only when it covers the
  // total — otherwise the customer tops up via Morse or pays cash/MoMo.
  if (paymentMethod === "gasfee") {
    await refreshRateUgx();
    const rateUgx = usdtConfig().rateUgx;
    const snap = await snapshotWallet(sb, customerId);
    const gasUgx = snap.availableUgx + snap.availableUsdt * rateUgx;
    if (gasUgx < totalUgx) {
      return NextResponse.json({
        error: "Your GoDoor gas fee is too low for this order. Top up from your Morse wallet, or pay cash, MTN MoMo or Airtel Money.",
        code: "INSUFFICIENT_GAS_FEE",
        availableGasUgx: Math.floor(gasUgx),
        requiredUgx: totalUgx,
      }, { status: 402 });
    }
  }

  // Idempotency: replaying the same key returns the original order instead of a duplicate.
  const idempotencyKeyRaw = typeof body.idempotency_key === "string" ? body.idempotency_key.slice(0, 128) : "";
  const idempotencyKey = idempotencyKeyRaw || "";

  const { data, error } = await sb.from("orders").insert({
    merchant_id: merchantId,
    merchant_name: body.merchant_name || merchant.name || "",
    customer_id: customerId,
    customer_name: body.customer_name || "",
    customer_email: actor.kind === "user" ? (actor.email || body.customer_email || "") : (body.customer_email || ""),
    customer_phone: typeof body.customer_phone === "string" ? body.customer_phone : "",
    items: typeof body.items === "string" ? body.items : "",
    line_items: lineItems,
    subtotal_ugx: subtotal,
    delivery_fee_ugx: deliveryFee,
    service_fee_ugx: serviceFee,
    total_ugx: totalUgx,
    delivery_address: typeof body.delivery_address === "string" ? body.delivery_address : "",
    customer_lat: customerLat,
    customer_lng: customerLng,
    status,
    payment_method: paymentMethod,
    payment_confirmed: false,
    notes: typeof body.notes === "string" ? body.notes : "",
    scheduled_for: scheduledFor,
    idempotency_key: idempotencyKey || null,
  }).select().single();

  if (error) {
    // Unique idempotency_key collision → return the existing order (idempotent replay).
    if (idempotencyKey && /duplicate key|unique/i.test(String(error.message))) {
      const { data: existing } = await sb
        .from("orders")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return NextResponse.json({ order: existing, replayed: true });
    }
    console.error("createOrder API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Gas fee settlement ───────────────────────────────────────────────────
  // Balance was preflighted above; now actually move the money (immutable
  // ledger rows) and mark the order paid. If the debit somehow fails, the
  // order is cancelled rather than left as an unpaid phantom.
  if (paymentMethod === "gasfee" && customerId && data) {
    try {
      await refreshRateUgx();
      await debitGasFee(sb, customerId, {
        amountUgx: totalUgx,
        reference: String(data.id),
        note: `Order ${String(data.id).slice(0, 8)} paid from GoDoor gas fee`,
        rateUgx: usdtConfig().rateUgx,
      });
      await sb.from("orders").update({ payment_confirmed: true, status: "payment_confirmed" }).eq("id", data.id);
      (data as Record<string, unknown>).payment_confirmed = true;
      (data as Record<string, unknown>).status = "payment_confirmed";
    } catch (e) {
      await sb.from("orders").update({ status: "cancelled", notes: "Gas fee payment failed — please order again" }).eq("id", data.id);
      return NextResponse.json({
        error: "Could not pay from your GoDoor gas fee. Top up via Morse or pick another payment method.",
        code: "GAS_FEE_PAY_FAILED",
      }, { status: 402 });
    }
  }
  return NextResponse.json({ order: data });
}