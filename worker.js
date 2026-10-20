/**
 * GoDoor — Cloudflare Worker edge proxy.
 *
 * ── What this does ─────────────────────────────────────────────────────────
 * The GoDoor platform is a Next.js app deployed to Vercel. This Worker sits in
 * front of the production domain and forwards every request to the Vercel
 * deployment, so `godoor.site` and `www.godoor.site` are served by the real
 * application.
 *
 * ── Why the target is the PROJECT ALIAS and not a deployment URL ───────────
 * Vercel gives every project a permanent production alias:
 *
 *   https://godoor-platform.vercel.app
 *
 * That alias ALWAYS points at the current production deployment. A hashed
 * deployment URL such as
 * `godoor-platform-f0w7u978d-ibrahimkapoor11-gmailcoms-projects.vercel.app`
 * points at ONE immutable build — once the app is redeployed, that URL keeps
 * serving the OLD build, and the site silently goes stale (new routes start
 * returning 404 while the old ones still work). Pointing at the alias means
 * "deploy to Vercel, and the domain follows", with no second deploy step and
 * no chance of the two drifting apart.
 *
 * ── Why NOT the production domain ─────────────────────────────────────────
 * The target must never be `godoor.site` itself: this Worker owns the route
 * for `godoor.site/*`, so forwarding to it would loop
 * (edge → worker → edge → worker → …) until the request times out.
 *
 * ── Correctness notes ──────────────────────────────────────────────────────
 *  • The upstream `Host` header is rewritten to the Vercel alias. Vercel
 *    routes by Host, and a `Host: godoor.site` header against a request that
 *    did not originate from a verified Vercel domain can be rejected.
 *  • The original hostname is forwarded as `x-forwarded-host` so the app can
 *    still tell which domain the visitor used (the app folds `www` into the
 *    apex itself).
 *  • Redirects are NOT followed — a 3xx is returned to the browser unchanged,
 *    so `Location` headers point at the real origin and not at this proxy.
 *  • The request body is streamed through untouched; GET/HEAD requests carry
 *    no body and must not be given one.
 */

const UPSTREAM = "https://godoor-platform.vercel.app";

/** Headers that describe the hop, not the message — never forward them. */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-real-ip",
]);

export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);

    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
    }

    // Tell Vercel which host to serve, and preserve the host the visitor used.
    headers.set("host", new URL(UPSTREAM).host);
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");

    const hasBody = request.method !== "GET" && request.method !== "HEAD";

    const upstream = new Request(UPSTREAM + incoming.pathname + incoming.search, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Let the browser follow the app's own redirects, not this proxy's.
      redirect: "manual",
    });

    const response = await fetch(upstream);

    // Rewrite upstream Location headers so they keep pointing at the public
    // domain instead of leaking the internal Vercel hostname.
    const location = response.headers.get("location");
    if (location) {
      try {
        const loc = new URL(location, UPSTREAM);
        const publicHost = incoming.host;
        const rewritten = new URL(loc.toString());
        rewritten.protocol = "https:";
        rewritten.host = publicHost;
        response.headers.set("location", rewritten.toString());
      } catch {
        /* keep the original Location */
      }
    }

    return response;
  },
};
