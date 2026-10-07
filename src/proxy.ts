import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

/** The canonical origin. `www` is folded into this. */
const CANONICAL_HOST = "godoor.site";

/** The alias that gets folded into the apex. */
const ALIAS_HOST = "www.godoor.site";

/**
 * The hostname Vercel actually routed this request to.
 *
 * `x-forwarded-host` is preferred over `host` because anything proxying in
 * front of the app may rewrite `host`; it can also be a comma-separated chain
 * in which case the first entry is the host the client originally asked for.
 */
function requestHost(req: NextRequest): string {
  const raw = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

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
 *
 * It also folds the `www` alias into the apex (see below), which is why that
 * check runs before any of the admin branches below.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 0) Host canonicalisation. GoDoor is served from both `godoor.site` and
  //    `www.godoor.site`; both stay attached to the Vercel project and both
  //    keep working, but only the apex is canonical. Left alone, each host
  //    rendered and counted as its own copy: every page was indexed twice (no
  //    rel=canonical was emitted), and because the Supabase session lives in
  //    origin-scoped localStorage, signing in on one alias left you signed out
  //    on the other.
  //
  //    This runs FIRST, before anything reads a cookie. That ordering is load
  //    bearing: the admin session cookie is host-only (no `domain` attribute in
  //    setSessionCookie), so folding the alias before any auth check means
  //    `www` never issues a cookie at all and can never strand one. It also
  //    means a stale `www` cookie cannot outlive the hop — the browser simply
  //    arrives at the apex without it and re-authenticates once.
  if (requestHost(request) === ALIAS_HOST) {
    // `clone()` retains pathname, query and hash, so deep links and campaign
    // parameters survive; only the host is swapped.
    const canonical = request.nextUrl.clone();
    canonical.hostname = CANONICAL_HOST;
    canonical.protocol = "https:";
    // 308 rather than Next's 307 default: 308 preserves the method and body, so
    // API calls issued against `www` (order create, wallet top-up, uploads)
    // are replayed against the apex instead of being downgraded to a GET.
    return NextResponse.redirect(canonical, 308);
  }

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

  // 2) The admin API. This must be checked before the /admin branch below:
  //    "/api/admin/..." does not start with "/admin", so a guard nested there
  //    is unreachable and every route would fall through unprotected.
  if (pathname.startsWith("/api/admin/")) {
    const token = request.cookies.get(ADMIN_COOKIE)?.value || "";
    return (await verifySession(token))
      ? NextResponse.next()
      : new NextResponse("Not Found", { status: 404 });
  }

  // 3) Hardcoded /admin references (nav links, redirects after login).
  if (pathname.startsWith("/admin")) {
    const token = request.cookies.get(ADMIN_COOKIE)?.value || "";
    const authorized = await verifySession(token);

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

export default proxy;
