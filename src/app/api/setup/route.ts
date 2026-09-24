import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { isAdminCookieValid } from "@/lib/api-auth";

export async function POST(req: Request) {
  // Arbitrary SQL execution must only be reachable by an authenticated admin.
  // Without it an anonymous caller could DROP TABLEs or exfiltrate the schema.
  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await req.json();
  const { sql } = body;
  if (!sql) {
    return NextResponse.json({ error: "No SQL provided" }, { status: 400 });
  }

  try {
    // Use Supabase's SQL endpoint through the Management API
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    
    const resp = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
