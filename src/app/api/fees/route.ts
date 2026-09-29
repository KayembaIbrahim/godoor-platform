import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveFees } from "@/lib/fees";

/** Public read of the active fee config so the cart and checkout can quote the
 *  same 15% service fee the server charges. Contains no secrets. */
export async function GET() {
  const sb = getServiceClient();
  let row: Record<string, unknown> | null = null;
  if (sb) {
    const { data } = await sb.from("fee_config").select("*").eq("id", "default").maybeSingle();
    row = (data as Record<string, unknown> | null) ?? null;
  }
  return NextResponse.json({ fees: resolveFees(row) });
}
