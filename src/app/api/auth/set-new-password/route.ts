import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { evaluatePassword, passwordError } from "@/lib/password-strength";

export const runtime = "nodejs";

/**
 * Sets a new password for the currently signed-in user.
 *
 * Used by the self-service password reset flow: the user clicks a recovery
 * link in an email → Supabase verifies the recovery token → redirects to
 * /reset-password with a valid session → this route updates the password.
 *
 * The caller is authenticated by their Supabase session cookie, so no
 * additional token or code is needed.
 */
export async function POST(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Enter a new password." }, { status: 400 });
  }

  const strength = evaluatePassword(password);
  if (!strength.ok) {
    return NextResponse.json(
      { error: passwordError(password) || "Password is too weak.", requirements: strength.requirements },
      { status: 400 },
    );
  }

  // Find the user by email to confirm they exist and get their id
  const { data: users, error: listError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError || !users?.users) {
    return NextResponse.json({ error: "We could not verify your account. Please try again." }, { status: 500 });
  }

  const user = users.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  // Update the password and clear the must_change_password flag
  const meta = user.user_metadata || {};
  const { error } = await sb.auth.admin.updateUserById(user.id, {
    password,
    user_metadata: { ...meta, must_change_password: false },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, email: user.email });
}