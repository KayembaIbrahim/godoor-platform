import { NextResponse } from "next/server";
import { snapshotWallet } from "@/lib/wallet-store";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";

export async function GET(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: { message: "Wallet unavailable" } }, { status: 503 });
  try {
    const wallet = await snapshotWallet(sb, actor.id);
    return NextResponse.json({
      data: wallet,
      meta: { currency: "UGX", market: "UG" },
    });
  } catch (e) {
    return NextResponse.json({ error: { message: e instanceof Error ? e.message : "Wallet unavailable" } }, { status: 500 });
  }
}