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

  const { data, error } = await sb.from("verification_documents").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ docs: [] });
  const docs = data || [];

  // Enrich with user display name where possible
  let users: any[] = [];
  try {
    const { data: u } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    users = u?.users || [];
  } catch {}

  const userById = new Map(users.map((u) => [u.id, u]));

  const enriched = docs.map((d) => {
    const user = d.user_id ? userById.get(String(d.user_id)) : null;
    const name = user?.user_metadata?.name || user?.email || "";
    // If the file_url is a base64 data URL, keep as-is (already viewable)
    return {
      ...d,
      user_name: name,
      user_email: user?.email || "",
    };
  });

  return NextResponse.json({ docs: enriched });
}

export async function PATCH(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { id, status, admin_note, user_id, role } = body;
  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });

  const { error: updateErr } = await sb.from("verification_documents").update({ status, admin_note: admin_note || "", reviewed_at: new Date().toISOString() }).eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Also update the rider/merchant verified flag
  if (status === "approved" && user_id && role) {
    if (role === "rider") {
      await sb.from("riders").update({ verified: true }).eq("id", user_id);
      // Try by email too
      await sb.from("riders").update({ verified: true }).eq("email", user_id);
    } else if (role === "business") {
      await sb.from("merchants").update({ verified: true }).eq("owner_id", user_id);
    }
  } else if (status === "rejected" && user_id && role) {
    if (role === "rider") {
      await sb.from("riders").update({ verified: false }).eq("id", user_id);
    } else if (role === "business") {
      await sb.from("merchants").update({ verified: false }).eq("owner_id", user_id);
    }
  }

  return NextResponse.json({ ok: true });
}
