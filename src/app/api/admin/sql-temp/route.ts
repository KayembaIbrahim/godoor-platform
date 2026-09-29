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
  const client = sb as unknown as {
    from(t: string): { select(c: string): { limit(n: number): { then(x: unknown): unknown } } };
    rpc(f: string, a: unknown): Promise<{ data: unknown; error: { message: string; code: string } | null }>;
  };

  if (typeof body.select === "string") {
    const { data, error } = await sb.from(body.select).select("*").limit(Number(body.limit) || 5);
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    return NextResponse.json({ ok: true, data });
  }

  if (typeof body.call === "string") {
    const { data, error } = await client.rpc(body.call, body.args || {});
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    return NextResponse.json({ ok: true, data });
  }

  const sql = typeof body.sql === "string" ? body.sql : "";
  if (!sql.trim()) return NextResponse.json({ error: "sql | select | call required" }, { status: 400 });

  const { data, error } = await client.rpc("exec_sql", { query: sql });
  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
