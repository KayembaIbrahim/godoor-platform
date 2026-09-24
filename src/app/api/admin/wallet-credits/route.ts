import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { creditWallet, listTopupRequests, setTopupStatus, type WalletCurrency } from "@/lib/wallet-store";
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
    .from("topup_requests")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ error: "Request not found or already settled" }, { status: 404 });

  const adminName = "Admin";
  if (status === "credited") {
    const currency: WalletCurrency = String(reqRow.currency) === "USDT" ? "USDT" : "UGX";
    try {
      await creditWallet(sb, String(reqRow.user_id), {
        amountUgx: Number(reqRow.amount_ugx),
        reference: String(reqRow.reference),
        currency,
        phone: String(reqRow.phone || ""),
        network: String(reqRow.network || ""),
        note: `Top-up ${reqRow.reference} verified by admin`,
        relatedId: String(reqRow.id),
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not credit wallet" }, { status: 500 });
    }
    await setTopupStatus(sb, String(reqRow.id), "credited", adminName, admin_note || "Credited");
    return NextResponse.json({ ok: true, credited: true, amountUgx: Number(reqRow.amount_ugx), currency });
  }

  await setTopupStatus(sb, String(reqRow.id), "rejected", adminName, admin_note || "Rejected");
  return NextResponse.json({ ok: true, credited: false });
}