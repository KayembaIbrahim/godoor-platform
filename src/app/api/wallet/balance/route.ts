import { NextResponse } from "next/server";
import { getWallet } from "@/lib/escrow";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const wallet = await getWallet(sb, actor.id);
  if (!wallet) {
    return NextResponse.json({
      data: { user_id: actor.id, available_balance: 0, escrow_balance: 0 },
    });
  }
  return NextResponse.json({ data: wallet });
}
