import type { MetadataRoute } from "next";

/**
 * `/robots.txt` did not exist at all — Next served its own 404 HTML page here,
 * so crawlers were told nothing about where the sitemap lived or which parts of
 * GoDoor are private.
 *
 * SECURITY: the admin portal does NOT live at `/admin` on the public internet;
 * `proxy.ts` serves an unguessable `/${ADMIN_PATH_SECRET}` and 404s every bare
 * `/admin` request from anonymous callers. That secret is deliberately absent
 * from this file — a robots.txt is public, so naming the admin path here would
 * hand the portal to anyone who fetched it. Disallowing the bare `/admin`
 * prefix costs nothing (it is already a hard 404) and stops crawlers wasting
 * requests on the dead path.
 *
 * Note this is a crawler hint, not an access control. Every real restriction
 * is enforced server-side in `proxy.ts`; nothing here is load-bearing.
 */
const DISALLOWED = [
  "/admin", // already a hard 404 for anonymous callers; kept out of the index
  "/api/", // machine endpoints, never pages
  "/setup", // one-time bootstrap, no public value
  "/checkout",
  "/cart",
  "/chat",
  "/tracking",
  "/orders",
  "/wallet",
  "/account",
  "/verification",
  "/onboarding",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED,
      },
    ],
    // Absolute and apex-rooted, so the `www` alias (which 308s here) and the
    // apex describe the same crawl target.
    sitemap: "https://godoor.site/sitemap.xml",
    host: "https://godoor.site",
  };
}