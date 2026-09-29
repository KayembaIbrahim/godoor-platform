import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const sql = typeof body.sql === "string" ? body.sql : "";
  if (!sql.trim()) return NextResponse.json({ error: "sql required" }, { status: 400 });

  const { data, error } = await sb.rpc("exec_sql" as never, { query: sql } as never);
  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
