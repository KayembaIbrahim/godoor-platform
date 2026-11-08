import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Pre-submit email check for the /partner form.
 * Returns whether the email is already a CUSTOMER login (the Asu Snacks trap:
 * business first creates a customer account, then the approved business is
 * unreachable because one email = one role). Public — returns only the
 * role, never account details.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ isCustomer: false, role: null, message: null });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ isCustomer: false, role: null, message: null });
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = (data?.users || []).find(
    (u) => String(u.email || "").toLowerCase() === email,
  );
  if (!found) return NextResponse.json({ isCustomer: false, role: null, message: null });
  const role = (found.user_metadata?.role as string) || "customer";
  return NextResponse.json({
    isCustomer: role === "customer",
    role,
    message: role === "customer"
      ? "This email is already registered as a customer login. Applying here will link your business/rider to this same login — your role will upgrade when the GoDoor team approves you. Continue only if that's the email you want to sign in with."
      : null,
  });
}
