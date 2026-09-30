import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Admin payouts.
 *
 * Two sources have to be merged, because they genuinely differ:
 *
 *  1. `payouts` rows — created transactionally by release_escrow when a
 *     delivery was paid from escrow. These are authoritative and already have
 *     an immutable ledger trail behind them.
 *  2. Orders that never held escrow (cash, MoMo, and every order placed before
 *     the escrow rollout). These have NO payout row at all. Hiding them would
 *     make 19 of the platform's real deliveries invisible, so they are computed
 *     from the order fields and flagged as `unsettled`.
 *
 * Morse tags are read from the party records (profiles / merchants), NOT from
 * the order. A tag copied from an order snapshot can be stale by the time
 * admin pays, and paying a stale tag sends the money nowhere.
 *
 * Read-only by design: this route reports who is owed what. It deliberately
 * does not move money — refunds are recorded here and executed by admin over
 * Morse, per the agreed workflow.
 */

/** Local formatter: keeps the client-side utils module (clsx/tailwind-merge)
 *  out of the server bundle just to print a number. */
const formatUgx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString("en-UG")}`;

export async function GET(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "all"; // all | unsettled | settled

  const [{ data: orders, error: ordersErr }, { data: payoutRows, error: payErr }] = await Promise.all([
    sb
      .from("orders")
      .select(
        "id, status, payment_status, created_at, subtotal_ugx, delivery_fee_ugx, service_fee_ugx, " +
          "business_fee_ugx, rider_fee_ugx, merchant_payout_ugx, rider_payout_ugx, escrow_hold_id, " +
          "customer_id, merchant_id, rider_id, customer_name, customer_phone, merchant_name, rider_name, rider_phone",
      )
      .in("status", ["delivered", "cancelled", "payment_confirmed", "ready", "preparing", "delivering", "rider_assigned"])
      .order("created_at", { ascending: false })
      .limit(300),
    sb.from("payouts").select("id, order_id, recipient_id, recipient_role, amount, currency, status, paid_at, created_at").limit(500),
  ]);

  if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 });
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  // The generated client types these selects as GenericStringError because the
  // columns are not in its schema snapshot; the column list above is the contract.
  const list = (orders ?? []) as Record<string, any>[];
  const payouts = (payoutRows ?? []) as Record<string, any>[];

  // ── Collect the parties we need Morse tags for ────────────────────
  const userIds = new Set<string>();
  for (const o of list) {
    if (o.customer_id) userIds.add(String(o.customer_id));
    if (o.rider_id) userIds.add(String(o.rider_id));
  }
  const merchantIds = new Set(list.map((o) => o.merchant_id).filter(Boolean).map(String));

  const [profilesRes, merchantsRes] = await Promise.all([
    userIds.size
      ? sb.from("profiles").select("id, morse_tag, name, phone").in("id", [...userIds])
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    merchantIds.size
      ? sb.from("merchants").select("id, morse_tag, name").in("id", [...merchantIds])
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const userTag = new Map<string, string>();
  for (const p of (profilesRes.data ?? []) as Record<string, unknown>[]) {
    const t = String(p.morse_tag ?? "").trim();
    if (t) userTag.set(String(p.id), t);
  }
  const merchantTag = new Map<string, string>();
  for (const m of (merchantsRes.data ?? []) as Record<string, unknown>[]) {
    const t = String(m.morse_tag ?? "").trim();
    if (t) merchantTag.set(String(m.id), t);
  }

  // ── Merge payout rows onto their orders ──────────────────────────
  const byOrder = new Map<string, Record<string, unknown>[]>();
  for (const p of payouts) {
    const key = String(p.order_id);
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key)!.push(p as Record<string, unknown>);
  }

  const rows = list.map((o) => {
    const orderPayouts = byOrder.get(String(o.id)) ?? [];
    const business = orderPayouts.find((p) => p.recipient_role === "business");
    const rider = orderPayouts.find((p) => p.recipient_role === "rider");

    const subtotal = Number(o.subtotal_ugx || 0);
    const delivery = Number(o.delivery_fee_ugx || 0);
    const escrowed = Boolean(o.escrow_hold_id) || o.payment_status === "released";

    // Prefer the recorded payout; fall back to the settlement columns; fall
    // back to recomputing the agreed 10% business / 5% rider split.
    const merchantOwed = business
      ? Number(business.amount)
      : escrowed
        ? Number(o.merchant_payout_ugx || 0)
        : Math.max(subtotal - Number(o.business_fee_ugx || Math.round(subtotal * 0.1)), 0);
    const riderOwed = rider
      ? Number(rider.amount)
      : escrowed
        ? Number(o.rider_payout_ugx || 0)
        : Math.max(delivery - Number(o.rider_fee_ugx || Math.round(delivery * 0.05)), 0);

    const fullySettled =
      orderPayouts.length > 0 && orderPayouts.every((p) => p.status === "paid");

    return {
      order_id: o.id,
      order_status: o.status,
      payment_status: o.payment_status ?? "unpaid",
      escrowed,
      created_at: o.created_at,
      amounts: {
        subtotal_ugx: subtotal,
        delivery_fee_ugx: delivery,
        service_fee_ugx: Number(o.service_fee_ugx || 0),
        platform_fees_ugx:
          Number(o.service_fee_ugx || 0) +
          Number(o.business_fee_ugx || Math.round(subtotal * 0.1)) +
          Number(o.rider_fee_ugx || Math.round(delivery * 0.05)),
        merchant_payout_ugx: merchantOwed,
        rider_payout_ugx: riderOwed,
        _fmt: { merchant: formatUgx(merchantOwed), rider: formatUgx(riderOwed) },
      },
      parties: {
        customer: {
          name: o.customer_name || "Customer",
          phone: o.customer_phone || null,
          morse_tag: o.customer_id ? userTag.get(String(o.customer_id)) || null : null,
        },
        business: {
          name: o.merchant_name || "Business",
          morse_tag: merchantTag.get(String(o.merchant_id)) || null,
        },
        rider: o.rider_id
          ? {
              name: o.rider_name || "Rider",
              phone: o.rider_phone || null,
              morse_tag: userTag.get(String(o.rider_id)) || null,
            }
          : null,
      },
      payouts: orderPayouts.map((p) => ({
        id: p.id,
        role: p.recipient_role,
        amount: Number(p.amount),
        status: p.status,
        paid_at: p.paid_at ?? null,
      })),
      settled: fullySettled,
      // Nothing was ever held, so a wallet refund is not possible. Admin
      // refunds over Morse instead — the agreed workflow.
      refundable_to_wallet: Boolean(o.escrow_hold_id) && o.status === "cancelled",
    };
  });

  const filtered =
    scope === "unsettled"
      ? rows.filter((r) => !r.settled)
      : scope === "settled"
        ? rows.filter((r) => r.settled)
        : rows;

  return NextResponse.json({
    rows: filtered,
    totals: {
      orders: rows.length,
      unsettled: rows.filter((r) => !r.settled).length,
      owed_merchant_ugx: rows.filter((r) => !r.settled).reduce((s, r) => s + r.amounts.merchant_payout_ugx, 0),
      owed_rider_ugx: rows.filter((r) => !r.settled).reduce((s, r) => s + r.amounts.rider_payout_ugx, 0),
      platform_fees_ugx: rows.filter((r) => !r.settled).reduce((s, r) => s + r.amounts.platform_fees_ugx, 0),
      _fmt: {
        owed_merchant: formatUgx(rows.filter((r) => !r.settled).reduce((s, r) => s + r.amounts.merchant_payout_ugx, 0)),
        owed_rider: formatUgx(rows.filter((r) => !r.settled).reduce((s, r) => s + r.amounts.rider_payout_ugx, 0)),
        platform_fees: formatUgx(rows.filter((r) => !r.settled).reduce((s, r) => s + r.amounts.platform_fees_ugx, 0)),
      },
    },
  });
}
