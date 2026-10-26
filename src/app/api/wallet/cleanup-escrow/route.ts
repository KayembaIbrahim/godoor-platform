import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { cleanOrphanedEscrowHolds } from "@/lib/escrow";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: { message: "Wallet unavailable" } }, { status: 503 });
  
  try {
    const count = await cleanOrphanedEscrowHolds(sb);
    return NextResponse.json({ cleaned: count });
  } catch (e) {
    console.error("cleanup escrow error:", e);
    return NextResponse.json({ error: { message: e instanceof Error ? e.message : "Cleanup failed" } }, { status: 500 });
  }
}