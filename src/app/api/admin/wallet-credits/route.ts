import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { listTopupRequests, type WalletCurrency } from "@/lib/wallet-store";
import { collectionConfig, refreshRateUgx, usdtConfig } from "@/lib/momo";
import { isUuid } from "@/lib/api-auth";

/**
 * Admin wallet credits: the admin verifies that real mobile money arrived for
 * a pending top-up request and credits the customer's wallet (server-side,
 * immutable ledger). Only a still-pending request can be settled.
 */
export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  await refreshRateUgx();
  let config: { number: string; name: string } | null = null;
  try { config = collectionConfig(); } catch {}
  let usdt: ReturnType<typeof usdtConfig> | null = null;
  try { usdt = usdtConfig(); } catch {}

  const pending = await listTopupRequests(sb, "pending");
  const history = (await listTopupRequests(sb)).filter((r) => r.status !== "pending");

  return NextResponse.json({ pending, history, config: config || null, usdt });
}

export async function PATCH(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { id, status, admin_note } = body;
  if (!id || !isUuid(String(id)) || !["credited", "rejected"].includes(status)) {
    return NextResponse.json({ error: "Valid id and status (credited|rejected) required" }, { status: 400 });
  }

  // Load the request while it is still pending.
  const { data: reqRow } = await sb
    .from("deposits")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ error: "Request not found or already settled" }, { status: 404 });

  // Settle through the deposit RPC. It flips the row to settled AND pays the
  // wallet inside one transaction — crediting first and marking afterwards let a
  // crash between the two steps pay the customer a second time on retry.
  const adminName = "Admin";
  const isCredit = status === "credited";
  const fn = isCredit ? "credit_deposit" : "reject_deposit";
  const args = isCredit
    ? { p_deposit_id: id, p_note: admin_note || "Credited" }
    : { p_deposit_id: id, p_note: admin_note || "Rejected" };

  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result = (Array.isArray(data) ? data[0] : data) as { success?: boolean; message?: string } | null;
  if (!result || result.success !== true) {
    return NextResponse.json({ error: result?.message || "Could not settle deposit" }, { status: 409 });
  }

  if (!isCredit) return NextResponse.json({ ok: true, credited: false });

  const currency: WalletCurrency = String(reqRow.currency) === "USDT" ? "USDT" : "UGX";
  return NextResponse.json({
    ok: true,
    credited: true,
    amountUgx: Number(reqRow.amount),
    currency,
    reviewedBy: adminName,
  });
}