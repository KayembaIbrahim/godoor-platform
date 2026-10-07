import type { MetadataRoute } from "next";

/**
 * `/sitemap.xml` did not exist. This lists only the pages a prospective
 * customer or partner would land on from search or a shared link.
 *
 * SECURITY: everything account-scoped is omitted — `/wallet`, `/orders`,
 * `/account`, `/checkout`, `/cart`, `/chat`, `/tracking`, `/verification` — and
 * so is the admin portal. The admin portal's real address is an
 * `ADMIN_PATH_SECRET` that is not known at build time, so it cannot be listed
 * here even accidentally; `/admin` is excluded for the same reason robots.ts
 * excludes it. Nothing in this file reads a user, a session or a cookie, so it
 * stays a static route handler and costs no database round trip per build.
 */

const ORIGIN = "https://godoor.site";

type Entry = {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
};

const PAGES: Entry[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/app", changeFrequency: "daily", priority: 0.9 },
  { path: "/ride", changeFrequency: "daily", priority: 0.9 },
  { path: "/how-it-works", changeFrequency: "weekly", priority: 0.8 },
  { path: "/business", changeFrequency: "weekly", priority: 0.8 },
  { path: "/partner", changeFrequency: "weekly", priority: 0.7 },
  { path: "/rider", changeFrequency: "weekly", priority: 0.7 },
  { path: "/help", changeFrequency: "monthly", priority: 0.6 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  // One timestamp for the whole document rather than a fresh `new Date()` per
  // entry: a crawl that straddles a rebuild should not see entries stamped a
  // few milliseconds apart.
  const lastModified = new Date();

  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${ORIGIN}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}