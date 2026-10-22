import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Self-service password reset request.
 *
 * Public endpoint: a user who forgot their password enters their email here.
 * We ask Supabase to send a recovery email via its configured SMTP. The email
 * contains a link that takes the user to /reset-password where they can set a
 * new password.
 *
 * We never reveal whether the email exists in the system (uniform response).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: true });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: true });

  try {
    // Check if a user with this email exists in auth
    const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = users?.users?.find((u) => u.email?.toLowerCase() === email);

    if (user) {
      // Generate a recovery link. Supabase sends the email via its SMTP.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://godoor.site";
      const redirectTo = `${appUrl}/reset-password`;

      const { data, error } = await sb.auth.admin.generateLink({
        type: "recovery",
        email: user.email!,
        options: { redirectTo },
      });

      if (error) {
        // Log but don't expose to user
        console.warn("Supabase generateLink error:", error.message);
      }
      // Note: data.properties.action_link contains the link sent in the email
    }
  } catch (e) {
    // Never reveal whether the email exists or any internal error
    console.warn("Password reset request error:", e);
  }

  return NextResponse.json({ ok: true });
}