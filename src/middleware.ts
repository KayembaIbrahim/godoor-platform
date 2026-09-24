import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

/**
 * Hides the GoDoor admin portal behind an unguessable path.
 *
 * The portal's canonical address is `/${ADMIN_PATH_SECRET}` (server-rewritten
 * to the `/admin` app). Bare `/admin` and `/admin/...` are NOT public:
 *  - anonymous visitors get a hard 404 (probing leaks nothing)
 *  - signed-in admins are bounced with a 307 to the secret path
 *  - `/api/admin/*` stays locked (404 anonymous, allowed with a session)
 *
 * The secret never leaves the server — it is only read from an env var here.
 * When `ADMIN_PATH_SECRET` is unset (local dev), admin behaves as before.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The auth endpoint is public — it validates the password itself.
  if (pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_PATH_SECRET || "admin";

  // 1) The real admin address. Rewrite server-side so the app renders the
  //    /admin page but the browser only ever sees the secret path.
  if (secret !== "admin") {
    if (pathname === `/${secret}` || pathname.startsWith(`/${secret}/`)) {
      const rest = pathname.slice(secret.length + 1);
      const target = rest ? `/admin${rest}` : "/admin";
      return NextResponse.rewrite(
        new URL(target + request.nextUrl.search, request.url),
      );
    }
  }

  // 2) Hardcoded /admin references (nav links, redirects after login).
  if (pathname.startsWith("/admin")) {
    const token = request.cookies.get(ADMIN_COOKIE)?.value || "";
    const authorized = await verifySession(token);

    if (pathname.startsWith("/api/admin/")) {
      return authorized
        ? NextResponse.next()
        : new NextResponse("Not Found", { status: 404 });
    }

    if (secret !== "admin") {
      // Canonical location is the secret path — send signed-in admins there.
      if (!authorized) return new NextResponse("Not Found", { status: 404 });
      const rest = pathname.slice("/admin".length) + request.nextUrl.search;
      return NextResponse.redirect(new URL(`/${secret}${rest}`, request.url));
    }

    // Local dev (no secret): keep the old behaviour.
    if (!authorized) {
      if (pathname !== "/admin") {
        return NextResponse.redirect(new URL("/admin", request.url));
      }
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}