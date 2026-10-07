import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { riderVerificationStatus } from "@/lib/rider-verification";

/**
 * Verification status for the rider dashboard.
 *
 * This used to short-circuit on an unverified `riders` row:
 *
 *     if (!error && data && !data.verified) return { status: "none" };
 *
 * `/app/rider` auto-creates a `riders` row (verified: false) for any signed-in
 * user who lacks one, so that early return made the auto-created row hide the
 * merchant and approved-document evidence underneath it. The rider was then
 * shown "Verification required for Boda" and the server's accept gate refused
 * them — a dead end the rider could not clear from the UI.
 *
 * The ordering now lives in one place, `@/lib/rider-verification`, which the
 * accept gate calls too, so the board a rider sees and the 403 they would get
 * can no longer disagree.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("id") || "";
  const email = req.nextUrl.searchParams.get("email") || "";
  if (!userId && !email) return NextResponse.json({ status: "none" });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  try {
    return NextResponse.json({ status: await riderVerificationStatus(sb, userId, email) });
  } catch (err) {
    console.error("verify route error:", err);
  }
  return NextResponse.json({ status: "none" });
}
