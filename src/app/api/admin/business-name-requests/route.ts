import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Admin review of business name change requests.
 * Approving applies the new name to the merchants table.
 */

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS business_name_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id UUID NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  old_name TEXT NOT NULL DEFAULT '',
  new_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_name_req_merchant ON business_name_requests(merchant_id);
CREATE INDEX IF NOT EXISTS idx_name_req_status ON business_name_requests(status);`;

async function ensureTable(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
  const { error } = await sb.from("business_name_requests").select("id", { count: "exact", head: true });
  if (error) console.error("[business_name_requests] Table may not exist:", error.message);
}

// GET: list name change requests (pending first)
export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  await ensureTable(sb);
  const { data } = await sb.from("business_name_requests").select("*").limit(500);

  const requests = (data || []).slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
  // Attach merchant names for display
  const ids = Array.from(new Set(requests.map((r) => String(r.merchant_id))));
  let merchantNames: Record<string, string> = {};
  if (ids.length) {
    const { data: merchants } = await sb.from("merchants").select("id,name").in("id", ids);
    merchantNames = Object.fromEntries((merchants || []).map((m) => [String(m.id), m.name || ""]));
  }
  return NextResponse.json({
    requests: requests.map((r) => ({ ...r, merchant_name: merchantNames[String(r.merchant_id)] || "" })),
  });
}

// POST: approve or reject a request
export async function POST(req: NextRequest) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { id, decision, admin_note } = body || {};
  if (!id || !["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "id and decision (approved|rejected) required" }, { status: 400 });
  }

  await ensureTable(sb);
  const { data: reqRow } = await sb.from("business_name_requests").select("*").eq("id", id).maybeSingle();
  if (!reqRow) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
  }

  const update: Record<string, unknown> = {
    status: decision,
    admin_note: admin_note || "",
    reviewed_by: "admin",
    reviewed_at: new Date().toISOString(),
  };

  if (decision === "approved") {
    // Apply the new name to the merchant row (this is the ONLY name write path)
    await sb.from("merchants").update({ name: reqRow.new_name, updated_at: new Date().toISOString() }).eq("id", reqRow.merchant_id);
    // Keep every screen that renders the merchant name (order cards, chat,
    // admin) in sync — propagate the rename onto existing orders.
    await sb.from("orders").update({ merchant_name: reqRow.new_name }).eq("merchant_id", reqRow.merchant_id);
  }

  const { error } = await sb.from("business_name_requests").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
