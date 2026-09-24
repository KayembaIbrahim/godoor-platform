import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, getMerchantForUser, isUuid } from "@/lib/api-auth";
import { ensureClinicOrderSchema } from "@/lib/ensure-clinic";

/**
 * PATCH /api/orders/items — clinic "medicine delta".
 * The doctor's clinic adds pharmacy line items to an existing appointment
 * order; amounts are recomputed server-side from the products table (never
 * trusted from the body). The delta shows up under `medicine_subtotal_ugx`
 * and is folded into the order total, which the customer pays separately.
 */
export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  await ensureClinicOrderSchema(sb);

  const body = await req.json().catch(() => ({}));
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const requested: Array<{ productId: string; quantity: number }> = Array.isArray(body.items)
    ? body.items.map((li: Record<string, unknown>) => ({
        productId: String(li.productId ?? ""),
        quantity: Math.max(1, Math.floor(Number(li.quantity) || 1)),
      })).filter((li: { productId: string }) => li.productId)
    : [];
  if (!isUuid(orderId)) return NextResponse.json({ error: "A valid order is required" }, { status: 400 });
  if (requested.length === 0) return NextResponse.json({ error: "No medicine items provided" }, { status: 400 });

  const { data: orderRow, error: fetchErr } = await sb
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!orderRow) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = orderRow as Record<string, unknown>;
  const merchantId = String(order.merchant_id || "");

  // Only the owning clinic (or admin) can bill medicine against the order.
  if (actor.kind === "user") {
    const merchantIdOfCaller = (await getMerchantForUser(sb, actor.id))?.id || null;
    if (!merchantId || !merchantIdOfCaller || merchantId !== merchantIdOfCaller) {
      return NextResponse.json({ error: "You do not own this clinic." }, { status: 403 });
    }
  }

  // Resolve every medicine against the clinic's product catalog.
  const productIds = [...new Set(requested.map((li) => li.productId))];
  const prices = new Map<string, { price: number; name: string }>();
  for (let i = 0; i < productIds.length; i += 50) {
    const chunk = productIds.slice(i, i + 50);
    const { data: rows } = await sb
      .from("products")
      .select("id, name, price, available")
      .eq("merchant_id", merchantId)
      .in("id", chunk);
    for (const row of rows || []) {
      if ((row as { available: boolean }).available !== false) {
        prices.set(String(row.id), { price: Number((row as { price: number }).price ?? 0), name: String((row as { name: string }).name || "") });
      }
    }
  }

  const medicineItems = requested.map((li) => {
    const p = prices.get(li.productId) || { price: 0, name: "Medicine" };
    return {
      productId: li.productId,
      merchantId,
      name: p.name,
      unitPriceUgx: p.price,
      quantity: li.quantity,
      bulky: false,
      related: "medicine",
    };
  });

  const medicineSubtotal = medicineItems.reduce((sum, li) => sum + li.unitPriceUgx * li.quantity, 0);
  if (medicineSubtotal <= 0) {
    return NextResponse.json({ error: "Those medicines are not available in the clinic catalog" }, { status: 400 });
  }

  // Recompute the order money server-side. Existing delivery fee stays as-is
  // (delivery for the appointment itself may not apply); the medicine delta
  // pays the same proportional service fee.
  const DEFAULT_FEES = { service_fee_percent: 5, service_fee_min_ugx: 0, service_fee_max_ugx: 10000 };
  let fees = { ...DEFAULT_FEES };
  try {
    const { data: f } = await sb.from("fee_config").select("*").eq("id", "default").single();
    if (f) {
      fees = {
        service_fee_percent: Number((f as Record<string, unknown>).service_fee_percent ?? DEFAULT_FEES.service_fee_percent),
        service_fee_min_ugx: Number((f as Record<string, unknown>).service_fee_min_ugx ?? DEFAULT_FEES.service_fee_min_ugx),
        service_fee_max_ugx: Number((f as Record<string, unknown>).service_fee_max_ugx ?? DEFAULT_FEES.service_fee_max_ugx),
      };
    }
  } catch {}

  const prevSubtotal = Number(order.subtotal_ugx || 0);
  const prevDelivery = Number(order.delivery_fee_ugx || 0);
  const prevService = Number(order.service_fee_ugx || 0);
  const newServiceRaw = Math.round((medicineSubtotal * fees.service_fee_percent) / 100);
  const newService = Math.min(fees.service_fee_max_ugx, Math.max(fees.service_fee_min_ugx, newServiceRaw));

  const subtotalUgx = prevSubtotal + medicineSubtotal;
  const serviceFeeUgx = prevService + newService;
  const totalUgx = subtotalUgx + prevDelivery + serviceFeeUgx;

  const existingItems: Record<string, unknown>[] = Array.isArray(order.line_items)
    ? (order.line_items as unknown[])
        .map((li) => (typeof li === "object" && li ? li : {}))
        .map((li) => ({ ...(li as Record<string, unknown>) }))
    : [];
  const mergedItems = existingItems.concat(medicineItems);

  const { data: updated, error } = await sb
    .from("orders")
    .update({
      line_items: mergedItems,
      subtotal_ugx: subtotalUgx,
      service_fee_ugx: serviceFeeUgx,
      total_ugx: totalUgx,
      medicine_subtotal_ugx: medicineSubtotal + Number(order.medicine_subtotal_ugx || 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ order: updated, medicine_subtotal_ugx: medicineSubtotal });
}