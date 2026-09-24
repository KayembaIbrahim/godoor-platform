import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { grantSignupBonus } from "@/lib/wallet-store";

export async function POST(req: Request) {
  try {
    const { email, password, name, role } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Customer signup only. Businesses & riders are onboarded by GoDoor.
    // Reject explicit business/rider/admin requests instead of quietly
    // downgrading them — an admin role can never be self-assigned, and a
    // would-be merchant gets pointed at /partner rather than a surprise
    // customer account.
    if (role && role !== "customer") {
      return NextResponse.json({
        error: "Business and rider accounts are created by the GoDoor team. Apply at /partner instead.",
      }, { status: 403 });
    }

    const sb = getServiceClient();
    if (!sb) {
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    // Create user with auto-confirm (bypasses email rate limit)
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || "", role: "customer", morse_tag: "" },
    });

    if (error) {
      // If user already exists, that's OK — they can sign in
      if (error.message?.includes("already") || error.message?.includes("exists")) {
        return NextResponse.json({ ok: true, alreadyExists: true });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // New customers start with a free 2000 UGX gas fee to cover service fees on
    // their first orders. When it runs out they top up their GoDoor balance
    // from the Morse partner wallet.
    const userId = data.user?.id;
    if (userId) await grantSignupBonus(sb, userId);

    return NextResponse.json({ ok: true, user: { id: data.user?.id, email: data.user?.email } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
