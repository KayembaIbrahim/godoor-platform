import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { getList, updateList, addMessage } from "@/lib/shopping-list-store";
import { debitWallet, snapshotWallet } from "@/lib/wallet-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/shopping-list/topup { listId, amountUgx, note? }
 *
 * Customer adds extra funds when the rider's actual cost exceeds the estimate.
 * The amount is debited from the customer's wallet (UGX) and recorded as
 * extra_funded_ugx on the list. Never trusts a client total — the delta is
 * recomputed server-side from actual vs estimate.
 */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  let body: { listId?: unknown; amountUgx?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const listId = typeof body.listId === "string" ? body.listId.trim() : "";
  const amountUgx = typeof body.amountUgx === "number" ? Math.trunc(body.amountUgx) : 0;
  if (!listId) return NextResponse.json({ error: "listId required" }, { status: 400 });
  if (!Number.isFinite(amountUgx) || amountUgx <= 0) {
    return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
  }
  if (amountUgx > 50_000_000) {
    return NextResponse.json({ error: "Amount too large" }, { status: 400 });
  }

  const row = await getList(sb, listId);
  if (!row) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  if (row.customer_id !== actor.id) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  if (["delivered", "cancelled"].includes(row.status)) {
    return NextResponse.json({ error: "This list is closed" }, { status: 409 });
  }

  // Idempotent per list+amount if caller retries with same note
  const note = typeof body.note === "string" ? body.note.slice(0, 200) : "GoMart extra funds";

  try {
    await debitWallet(sb, actor.id, {
      amountUgx,
      reference: `gomart-topup:${listId}:${Date.now()}`,
      note: `GoMart extra funds for list ${listId.slice(-6)}`,
      currency: "UGX",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Wallet debit failed";
    if (/insufficient/i.test(msg)) {
      return NextResponse.json({ error: "Insufficient wallet balance — top up your wallet first", code: "INSUFFICIENT_BALANCE" }, { status: 402 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const prevExtra = row.extra_funded_ugx ?? 0;
  const result = await updateList(sb, listId, {
    extraFundedUgx: prevExtra + amountUgx,
    actorRole: "customer",
    actorId: actor.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const senderName = (actor as { name?: string }).name || (actor as { email?: string }).email || "Customer";
  await addMessage(sb, listId, actor.id, senderName, actor.role || "customer", `Added ${amountUgx.toLocaleString()} UGX extra funds. ${note || ""}`.trim(), "fund_topup", amountUgx);

  const wallet = await snapshotWallet(sb, actor.id).catch(() => null);
  return NextResponse.json({
    success: true,
    amountUgx,
    extraFundedUgx: prevExtra + amountUgx,
    list: result.list,
    wallet: wallet ? { availableUgx: wallet.availableUgx } : null,
  });
}
