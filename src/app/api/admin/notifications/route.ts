import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

export type AdminNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: number;
};

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const items: AdminNotification[] = [];

  // 1. Pending merchant approvals
  try {
    const { data } = await sb.from("merchants").select("id,name,created_at").eq("status", "pending");
    for (const m of data || []) {
      items.push({
        id: `merchant-pending-${m.id}`,
        type: "merchant_pending",
        title: "New business registration",
        body: `"${m.name}" is waiting for approval.`,
        href: "/admin/merchants",
        read: false,
        createdAt: m.created_at ? new Date(m.created_at).getTime() : now,
      });
    }
  } catch {}

  // 2. Open disputes
  try {
    const { data } = await sb.from("disputes").select("id,reason,created_at").eq("status", "open");
    for (const d of data || []) {
      items.push({
        id: `dispute-${d.id}`,
        type: "dispute",
        title: "Open dispute",
        body: (d.reason || "A new dispute needs attention."),
        href: "/admin/disputes",
        read: false,
        createdAt: d.created_at ? new Date(d.created_at).getTime() : now,
      });
    }
  } catch {}

  // 3. Pending verification documents
  try {
    const { data } = await sb.from("verification_documents")
      .select("id,document_type,role,user_id,created_at")
      .eq("status", "pending");
    for (const v of data || []) {
      items.push({
        id: `verif-${v.id}`,
        type: "verification",
        title: "Verification pending",
        body: `A ${v.role || "user"} submitted ${v.document_type || "documents"} for review.`,
        href: "/admin/verifications",
        read: false,
        createdAt: v.created_at ? new Date(v.created_at).getTime() : now,
      });
    }
  } catch {}

  // 3b. Pending Morse tag change requests (support must reach the user)
  try {
    const { data } = await sb.from("morse_tag_change_requests")
      .select("id,kind,user_email,user_name,merchant_name,requested_tag,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    for (const r of data || []) {
      const who = r.kind === "merchant" ? (r.merchant_name || "a business") : (r.user_email || "a user");
      items.push({
        id: `morse-tag-${r.id}`,
        type: "morse_tag_change",
        title: `Morse tag change: @${String(r.requested_tag || "").replace(/^@/, "")}`,
        body: `${who} wants to switch their fixed Morse tag — contact them to verify before approving.`,
        href: "/admin/morse-tag-requests",
        read: false,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : now,
      });
    }
  } catch {}

  // 4. Recent orders (last 24h)
  try {
    const { data } = await sb.from("orders")
      .select("id,status,items,merchant_name,total_ugx,created_at")
      .gte("created_at", dayAgo)
      .order("created_at", { ascending: false })
      .limit(5);
    for (const o of data || []) {
      let itemsText = "items";
      if (Array.isArray(o.items)) {
        itemsText = o.items.map((i: any) => typeof i === "string" ? i : (i.name || "item")).join(", ");
      }
      items.push({
        id: `order-${o.id}`,
        type: "order",
        title: `Order ${o.status?.replace(/_/g, " ") || "update"}`,
        body: `${itemsText} — ${o.merchant_name || "Merchant"} · UGX ${(o.total_ugx || 0).toLocaleString()}`,
        href: "/admin/orders",
        read: false,
        createdAt: o.created_at ? new Date(o.created_at).getTime() : now,
      });
    }
  } catch {}

  // 5. New users (last 24h)
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const recent = (data?.users || []).filter((u) => new Date(u.created_at).getTime() > now - 24 * 60 * 60 * 1000);
    for (const u of recent.slice(0, 5)) {
      items.push({
        id: `user-${u.id}`,
        type: "new_user",
        title: "New user registered",
        body: `${u.email} joined as ${(u.user_metadata?.role as string) || "customer"}.`,
        href: "/admin/users",
        read: false,
        createdAt: new Date(u.created_at).getTime(),
      });
    }
  } catch {}

  items.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ items });
}
