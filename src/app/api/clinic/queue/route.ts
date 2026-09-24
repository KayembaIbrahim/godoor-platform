import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, getMerchantForUser, isUuid } from "@/lib/api-auth";
import { CLINIC_QUEUE_STATUSES, ensureClinicSchema } from "@/lib/ensure-clinic";

/** GET ?merchant_id= — clinic queue lines with linked order summaries. */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  await ensureClinicSchema(sb);
  const merchantId = req.nextUrl.searchParams.get("merchant_id");
  if (!isUuid(merchantId || "")) return NextResponse.json({ queue: [] });

  const { data, error } = await sb
    .from("clinic_queue")
    .select("*, orders(id, customer_name, status, scheduled_for, created_at, total_ugx)")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ queue: data || [] });
}

/** POST — assign the next queue number to an order (clinic owner). */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  await ensureClinicSchema(sb);

  const body = await req.json().catch(() => ({}));
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!isUuid(orderId)) return NextResponse.json({ error: "A valid order is required" }, { status: 400 });

  const merchantIdOfCaller = actor.kind === "user" ? (await getMerchantForUser(sb, actor.id))?.id || null : null;

  // Only the owning clinic (or admin) can assign queue numbers.
  if (actor.kind === "user") {
    if (!merchantIdOfCaller) return NextResponse.json({ error: "You do not own a business." }, { status: 403 });
    const { data: orderRow } = await sb.from("orders").select("merchant_id").eq("id", orderId).maybeSingle();
    const merchantId = (orderRow as { merchant_id: string | null } | null)?.merchant_id || null;
    if (!merchantId || merchantId !== merchantIdOfCaller) {
      return NextResponse.json({ error: "You do not own this order." }, { status: 403 });
    }
  }

  const { data: merchantRow } = await sb.from("orders").select("merchant_id").eq("id", orderId).maybeSingle();
  const merchantId = (merchantRow as { merchant_id: string | null } | null)?.merchant_id || null;
  if (!merchantId) return NextResponse.json({ error: "Order has no business." }, { status: 400 });

  // Next queue number = max + 1 for this clinic today's queue.
  const { data: latest } = await sb
    .from("clinic_queue")
    .select("queue_number")
    .eq("merchant_id", merchantId)
    .order("queue_number", { ascending: false })
    .limit(1);
  const nextNumber = Number((latest && latest[0]?.queue_number) || 0) + 1;

  const { data, error } = await sb
    .from("clinic_queue")
    .upsert(
      { order_id: orderId, merchant_id: merchantId, queue_number: nextNumber, status: "waiting" },
      { onConflict: "order_id", ignoreDuplicates: false },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

/** PATCH — move an appointment through the queue (waiting → in_consultation → done / no_show). */
export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  await ensureClinicSchema(sb);

  const body = await req.json().catch(() => ({}));
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!isUuid(orderId)) return NextResponse.json({ error: "A valid order is required" }, { status: 400 });
  if (!CLINIC_QUEUE_STATUSES.includes(status)) return NextResponse.json({ error: "Unknown queue status" }, { status: 400 });

  const { data: row } = await sb.from("clinic_queue").select("merchant_id").eq("order_id", orderId).maybeSingle();
  const merchantId = (row as { merchant_id: string | null } | null)?.merchant_id || null;
  if (!merchantId) return NextResponse.json({ error: "This order is not in the queue yet" }, { status: 404 });
  if (actor.kind === "user") {
    const merchantIdOfCaller = (await getMerchantForUser(sb, actor.id))?.id || null;
    if (!merchantId || !merchantIdOfCaller || merchantId !== merchantIdOfCaller) {
      return NextResponse.json({ error: "You do not own this clinic queue." }, { status: 403 });
    }
  }

  const { data, error } = await sb
    .from("clinic_queue")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}