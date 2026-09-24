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

  const [ordersRes, merchantsRes, ridersRes, usersRes, disputesRes, paymentsRes] = await Promise.all([
    sb.from("orders").select("*").limit(1000),
    sb.from("merchants").select("*").limit(1000),
    sb.from("riders").select("*").limit(1000),
    sb.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    sb.from("disputes").select("*").limit(500),
    sb.from("payments").select("*").limit(1000),
  ]);

  const orders = ordersRes.data || [];
  const merchants = merchantsRes.data || [];
  const riders = ridersRes.data || [];
  const users = usersRes.data?.users || [];
  const disputes = disputesRes.data || [];
  const payments = paymentsRes.data || [];

  return NextResponse.json({
    overview: {
      orders,
      merchants,
      riders,
      users: users.map((u: any) => ({
        id: u.id,
        email: u.email || "",
        name: (u.user_metadata?.name as string) || "",
        role: (u.user_metadata?.role as string) || "customer",
        created_at: new Date(u.created_at).getTime(),
      })),
      disputes,
      payments,
    },
  });
}
