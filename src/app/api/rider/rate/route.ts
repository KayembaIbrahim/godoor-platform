import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";

export const runtime = "nodejs";

/** GET /api/rider/rate — current per-km rate (default 1500). */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const { data } = await sb.from("riders").select("rate_per_km_ugx").eq("id", actor.id).maybeSingle();
  return NextResponse.json({ ratePerKmUgx: Number(data?.rate_per_km_ugx || 1500) });
}

/** PATCH /api/rider/rate — set own per-km rate (bounded 500–5000). */
export async function PATCH(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rate = Math.trunc(Number(body.ratePerKmUgx));
  if (!Number.isFinite(rate) || rate < 500 || rate > 5000) {
    return NextResponse.json({ error: "Rate must be between UGX 500 and UGX 5,000 per km" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("riders")
    .update({ rate_per_km_ugx: rate })
    .eq("id", actor.id)
    .select("rate_per_km_ugx")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ratePerKmUgx: Number(data?.rate_per_km_ugx || rate) });
}
