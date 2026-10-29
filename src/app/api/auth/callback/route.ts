import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * OAuth callback handler for Google and X (Twitter) sign-in.
 *
 * Supabase redirects here after the provider authenticates the user. We
 * exchange the authorization code for a session, then redirect to the
 * role-appropriate dashboard. Without this route the OAuth flow fails with
 * "no callback route configured" and the user lands on a 404.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/?error=${encodeURIComponent(errorDescription || error)}`,
        req.nextUrl.origin,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/?error=No+authorization+code+returned+by+the+provider", req.nextUrl.origin),
    );
  }

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!sbUrl || !sbKey || sbUrl.includes("YOUR_PROJECT")) {
    return NextResponse.redirect(
      new URL("/?error=Supabase+not+configured", req.nextUrl.origin),
    );
  }

  const sb = createClient(sbUrl, sbKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error: exchangeError } = await sb.auth.exchangeCodeForSession(code);

  if (exchangeError || !data?.session) {
    return NextResponse.redirect(
      new URL(
        `/?error=${encodeURIComponent(exchangeError?.message || "Session exchange failed")}`,
        req.nextUrl.origin,
      ),
    );
  }

  // Determine where to send the user based on their role metadata.
  const role = (data.session.user.user_metadata?.role as string) || "customer";
  const dest =
    role === "business" ? "/business"
    : role === "rider" ? "/rider"
    : role === "admin" ? "/admin"
    : "/app";

  // Set the session cookie so subsequent requests are authenticated.
  const res = NextResponse.redirect(new URL(dest, req.nextUrl.origin));
  const accessToken = data.session.access_token;
  const refreshToken = data.session.refresh_token;

  if (accessToken) {
    res.cookies.set("sb-access-token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
  }
  if (refreshToken) {
    res.cookies.set("sb-refresh-token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  return res;
}