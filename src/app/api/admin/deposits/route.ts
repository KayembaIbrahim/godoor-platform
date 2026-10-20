import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { listPendingDeposits, listSettledDeposits, expireOldDeposits } from "@/lib/escrow";
export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  await expireOldDeposits(sb);
  const pending = await listPendingDeposits(sb);
  // Settled deposits are returned alongside the pending ones so an approved
  // credit does not vanish from the portal the moment it is approved — the
  // history of what was credited has to stay on screen.
  const settled = await listSettledDeposits(sb);
  return NextResponse.json({ pending, settled });
}
