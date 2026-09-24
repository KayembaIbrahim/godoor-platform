import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, resolveMerchantWriteAccess } from "@/lib/api-auth";

/**
 * Business name changes: a shop's name is a protected identity field.
 * It can only change through an admin-approved request, and only once the
 * previous name change (or the business creation) is at least 30 days old.
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

const COOLDOWN_DAYS = 30;

async function ensureTable(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
  const { error } = await sb.from("business_name_requests").select("id", { count: "exact", head: true });
  if (error) console.error("[business_name_requests] Table may not exist:", error.message);
}

/** Earliest date a new name change may be approved, given the baseline (created_at or last approved change). */
function eligibleOn(baseline: string): Date {
  const base = new Date(baseline || Date.now());
  return new Date(base.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

// GET: latest name-change request(s) for a merchant (drives the pending badge)
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ requests: [] }, { status: 500 });

  const merchantId = req.nextUrl.searchParams.get("merchant_id");
  if (!merchantId) return NextResponse.json({ requests: [] });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (actor.kind === "user") {
    const access = await resolveMerchantWriteAccess(sb, merchantId, actor.id);
    if (!access.ok) return NextResponse.json({ requests: [] });
  }

  await ensureTable(sb);
  const { data, error } = await sb
    .from("business_name_requests")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) return NextResponse.json({ requests: [] });
  return NextResponse.json({ requests: data || [] });
}

// POST: submit a business name change request
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { merchant_id, owner_id, current_name, new_name, reason } = body || {};

  if (!merchant_id || !new_name || !String(new_name).trim()) {
    return NextResponse.json({ error: "Business and new name are required" }, { status: 400 });
  }
  const nextName = String(new_name).trim();
  if (nextName.length > 80) {
    return NextResponse.json({ error: "Business name must be 80 characters or fewer" }, { status: 400 });
  }

  await ensureTable(sb);

  // Load the merchant for the current name + created_at baseline
  const { data: merchant, error: mErr } = await sb.from("merchants").select("*").eq("id", merchant_id).maybeSingle();
  if (mErr || !merchant) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  if (actor.kind === "user") {
    const access = await resolveMerchantWriteAccess(sb, merchant_id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }

  if (String(merchant.name || "").trim().toLowerCase() === nextName.toLowerCase()) {
    return NextResponse.json({ error: "New name must be different from the current name" }, { status: 400 });
  }

  // Block if a request is still pending
  const { data: pending } = await sb
    .from("business_name_requests")
    .select("id")
    .eq("merchant_id", merchant_id)
    .eq("status", "pending")
    .maybeSingle();
  if (pending) {
    return NextResponse.json({ error: "You already have a pending name change request. We'll review it in the admin dashboard." }, { status: 409 });
  }

  // 30-day cooldown since the business was created / last approved name change
  const { data: lastApproved } = await sb
    .from("business_name_requests")
    .select("reviewed_at")
    .eq("merchant_id", merchant_id)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const baseline = lastApproved?.reviewed_at || merchant.created_at || new Date().toISOString();
  const eligible = eligibleOn(baseline);
  if (new Date().getTime() < eligible.getTime()) {
    return NextResponse.json({
      error: `Business name can only change once every ${COOLDOWN_DAYS} days. You can submit a request from ${eligible.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.`,
      eligible_on: eligible.toISOString(),
    }, { status: 409 });
  }

  const { data, error } = await sb.from("business_name_requests").insert({
    merchant_id,
    owner_id: owner_id || "",
    old_name: String(current_name || merchant.name || ""),
    new_name: nextName,
    reason: reason || "",
    status: "pending",
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, request: data });
}