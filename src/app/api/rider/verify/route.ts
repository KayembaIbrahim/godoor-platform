import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("id");
  const email = req.nextUrl.searchParams.get("email");
  if (!userId && !email) return NextResponse.json({ status: "none" });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  try {
    // Try by ID first
    if (userId) {
      const { data, error } = await sb.from("riders").select("verified").eq("id", userId).maybeSingle();
      if (!error && data?.verified) return NextResponse.json({ status: "approved" });
      if (!error && data && !data.verified) return NextResponse.json({ status: "none" });
    }

    // Try by email in riders table
    if (email) {
      const { data: riderByEmail } = await sb.from("riders").select("verified").eq("email", email.toLowerCase()).maybeSingle();
      if (riderByEmail?.verified) return NextResponse.json({ status: "approved" });
      if (riderByEmail && !riderByEmail.verified) return NextResponse.json({ status: "none" });
    }

    // Check merchants (business owner)
    if (userId) {
      const { data: merchantData } = await sb.from("merchants").select("verified").eq("owner_id", userId).maybeSingle();
      if (merchantData?.verified) return NextResponse.json({ status: "approved" });
    }
    if (email) {
      let merchantByEmail: any = null;
      try {
        const result = await sb.from("merchants").select("verified").eq("email", email.toLowerCase()).maybeSingle();
        merchantByEmail = result.data;
      } catch {}
      if (merchantByEmail?.verified) return NextResponse.json({ status: "approved" });
    }

    // Check verification_documents as fallback (column may or may not have user_email)
    try {
      let docQuery = sb.from("verification_documents").select("status");
      if (userId) {
        docQuery = docQuery.eq("user_id", userId);
      } else if (email) {
        docQuery = docQuery.or(`user_id.eq.${email},user_id.ilike.%${email}%`);
      }
      const { data: docs, error: docsError } = await docQuery.order("created_at", { ascending: false }).limit(10);
      if (!docsError && docs?.length) {
        if (docs.some((d) => d.status === "approved")) return NextResponse.json({ status: "approved" });
        if (docs.some((d) => d.status === "rejected")) return NextResponse.json({ status: "rejected" });
        return NextResponse.json({ status: "pending" });
      }
    } catch {}
  } catch (err) {
    console.error("verify route error:", err);
  }
  return NextResponse.json({ status: "none" });
}
