import { NextResponse } from "next/server";
import { getLedger } from "@/lib/escrow";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const ledger = await getLedger(sb, actor.id, limit);
  return NextResponse.json({ data: ledger });
}
