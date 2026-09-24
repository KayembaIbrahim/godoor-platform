import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { data, error } = await sb.from("disputes").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ disputes: [] });
  return NextResponse.json({ disputes: data || [] });
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
  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });
  const DISPUTE_STATUSES = ["open", "under_review", "resolved", "closed", "rejected"];
  if (!DISPUTE_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Unknown dispute status "${status}"` }, { status: 400 });
  }

  const { error } = await sb.from("disputes").update({ status, admin_note: admin_note || "", reviewed_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
