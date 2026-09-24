import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

export async function GET() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  if (!(await verifySession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ users: [] });
  }

  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error("admin users fetch failed:", error.message);
    return NextResponse.json({ users: [] });
  }

  const users = (data?.users || []).map((u) => ({
    id: u.id,
    email: u.email || "",
    name: (u.user_metadata?.name as string) || "",
    role: (u.user_metadata?.role as string) || "customer",
    created_at: new Date(u.created_at).getTime(),
  }));

  return NextResponse.json({ users });
}


export async function PATCH(req: Request) {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  if (!(await verifySession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { id, action, role } = body;
  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  // An admin must never moderate (ban/demote) another admin — prevents lock-outs
  const { data: target } = await sb.auth.admin.getUserById(id);
  const targetRole = (target?.user?.user_metadata?.role as string) || "customer";
  if (targetRole === "admin") {
    return NextResponse.json({ error: "You cannot modify another admin account" }, { status: 403 });
  }

  if (action === "ban") {
    // Ban for 10-years (87600 hours) — effectively permanent
    const { error } = await sb.auth.admin.updateUserById(id, { ban_duration: "87600h" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_role") {
    const ROLES = ["customer", "business", "rider", "admin"];
    if (typeof role !== "string" || !ROLES.includes(role)) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }
    const { error } = await sb.auth.admin.updateUserById(id, { user_metadata: { role } });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
