import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { requireApiUser, isAdminCookieValid } from "@/lib/api-auth";

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS phone_change_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  user_role TEXT NOT NULL DEFAULT 'customer',
  old_phone TEXT NOT NULL DEFAULT '',
  new_phone TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);`;

const UG_PHONE = /^(\+?256|0)[0-9]{9}$/;

async function ensureTable(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  // Try RPC first (if exec_sql exists), fall back to direct query
  try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
  // Verify table exists by attempting a select
  const { error } = await sb.from("phone_change_requests").select("id", { count: "exact", head: true });
  if (error) {
    // Table doesn't exist — try creating via raw SQL workaround
    console.error("[phone_change_requests] Table may not exist:", error.message);
  }
}

// POST: Submit a phone change request for YOUR OWN account.
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  // A signed-in user may only request a phone change for their own account.
  const auth = await requireApiUser(req);
  if (!auth.ok) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const user = auth.user;

  const body = await req.json().catch(() => ({}));
  const { old_phone, new_phone, reason } = body || {};

  if (!new_phone) {
    return NextResponse.json({ error: "new_phone required" }, { status: 400 });
  }
  if (!UG_PHONE.test(String(new_phone || ""))) {
    return NextResponse.json({ error: "Enter a valid Ugandan mobile number" }, { status: 400 });
  }
  if (!old_phone) {
    return NextResponse.json({ error: "Please enter your current phone number for verification" }, { status: 400 });
  }
  if (old_phone === new_phone) {
    return NextResponse.json({ error: "New number must be different from current number" }, { status: 400 });
  }

  await ensureTable(sb);

  // Force the requester to be the account owner — never trust a client-supplied user_id.
  const user_id = user.id;
  const user_email = user.email || "";
  const user_role = typeof user.role === "string" ? user.role : "customer";

  // Check for pending request already
  const { data: existing } = await sb
    .from("phone_change_requests")
    .select("id")
    .eq("user_id", user_id)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "You already have a pending phone change request. Wait for admin to review." }, { status: 409 });
  }

  const { data, error } = await sb.from("phone_change_requests").insert({
    user_id,
    user_email,
    user_name: String((body as { user_name?: unknown }).user_name || ""),
    user_role,
    old_phone: String(old_phone).trim(),
    new_phone: String(new_phone).trim(),
    reason: reason || "",
    status: "pending",
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, request: data });
}

// GET: List phone change requests.
//   - default: admin cookie required (admin review queue)
//   - ?mine=true: a signed-in user may only see their own pending requests
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const mine = req.nextUrl.searchParams.get("mine") === "true";
  if (mine) {
    const auth = await requireApiUser(req);
    if (!auth.ok) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    const { data } = await sb
      .from("phone_change_requests")
      .select("*")
      .eq("user_id", auth.user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return NextResponse.json({ requests: data || [] });
  }

  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = req.nextUrl.searchParams.get("status") || "pending";
  const { data, error } = await sb
    .from("phone_change_requests")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ requests: [] });
  return NextResponse.json({ requests: data || [] });
}

// PATCH: Approve or reject — admin cookie required.
// The phone number to apply is read from the request ROW, never from the client
// body, so a tampered request can never be used to hijack another account.
export async function PATCH(req: NextRequest) {
  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { id, status, admin_note } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status must be approved or rejected" }, { status: 400 });
  }

  // Load the authoritative request row.
  const { data: row } = await sb.from("phone_change_requests").select("*").eq("id", id).maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    status,
    admin_note: admin_note || "",
    reviewed_at: new Date().toISOString(),
  };
  if (!row.reviewed_by) update.reviewed_by = "admin";

  const { error } = await sb.from("phone_change_requests").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Apply the change from the stored row: server-authoritative values only.
  if (status === "approved" && row.user_id && row.new_phone) {
    const newPhone = String(row.new_phone).trim();
    if (row.user_role === "rider") {
      await sb.from("riders").update({ phone: newPhone }).eq("id", row.user_id);
    } else if (row.user_role === "business") {
      await sb.from("merchants").update({ phone: newPhone }).eq("owner_id", row.user_id);
    } else {
      // Customers store their phone in auth metadata (and best-effort profiles).
      // Merge into existing metadata so role/name are preserved.
      const { data: existingUser } = await sb.auth.admin.getUserById(row.user_id).catch(() => ({ data: null }));
      const meta = { ...((existingUser?.user?.user_metadata || {}) as Record<string, unknown>), phone: newPhone };
      await sb.auth.admin.updateUserById(row.user_id, { user_metadata: meta }).catch(() => {});
      try { await sb.from("profiles").upsert({ id: row.user_id, phone: newPhone }); } catch {}
    }
  }

  return NextResponse.json({ ok: true });
}