/**
 * Sponsored homepage banner — pure logic, no database and no React.
 *
 * WHY THIS EXISTS SEPARATE FROM `campaigns-core`
 * ------------------------------------------------
 * Campaigns are POPUPS: they interrupt, they are dismissed, and dismissal has
 * to survive a reload. The homepage banner is the opposite of an interruption —
 * it is the first thing on the screen, it is always in the same place, and it
 * is the main slot businesses pay for. Reusing the popup model would have given
 * it a dismiss key it does not want, and would have made "sponsored slot" and
 * "marketing popup" the same setting in the admin portal, so switching one off
 * would silently switch the other off too.
 *
 * So this is its own small model with its own admin page, sharing only the one
 * thing that genuinely must not be duplicated: URL validation. A `javascript:`
 * URL in a paid, admin-authored headline is an XSS vector, and it is stopped
 * here rather than escaped later at every call site.
 *
 * The rules that matter:
 *
 *  1. An invalid URL drops the FIELD, not the banner. A sponsor who typos a
 *     link should still get their headline and photo; they should not get a
 *     blank rectangle because the CTA could not be parsed.
 *  2. Nothing renders outside its schedule. A banner whose campaign ended last
 *     Tuesday is a lie in the largest slot on the screen.
 *  3. Image URLs are validated identically to link URLs — an `<img src>` is a
 *     request to an arbitrary host, and `data:` would let an admin-authored
 *     string smuggle markup into the page.
 */

import { safeUrl } from "./campaigns-core";

export const HERO_BANNER_KEY = "godoor:hero-banner:v1";

export const HERO_AUDIENCES = ["all", "customer", "rider", "business"] as const;
export type HeroAudience = (typeof HERO_AUDIENCES)[number];

export type HeroBanner = {
  id: string;
  /** Headline. Also used as the image alt text when no alt is supplied. */
  title: string;
  subtitle: string;
  /** Validated absolute http(s) URL, or null when unusable. */
  imageUrl: string | null;
  ctaLabel: string | null;
  /** Validated absolute http(s) URL or `/`-relative path. */
  ctaUrl: string | null;
  enabled: boolean;
  /** ISO 8601 inclusive. null = live from now on. */
  startsAt: string | null;
  /** ISO 8601 exclusive. null = runs indefinitely. */
  endsAt: string | null;
  /** Where the slot sits when several are live at once. Higher wins. */
  priority: number;
  audience: HeroAudience;
  updatedAt: string;
};

/** Empty slot. The home screen renders nothing when this is what it gets. */
export const EMPTY_BANNER: HeroBanner = {
  id: "",
  title: "",
  subtitle: "",
  imageUrl: null,
  ctaLabel: null,
  ctaUrl: null,
  enabled: false,
  startsAt: null,
  endsAt: null,
  priority: 0,
  audience: "all",
  updatedAt: "",
};

/* Hard ceilings — a fat-fingered admin must not be able to lock the home
   screen with a 40,000-character headline that pushes the categories below the
   fold on every device. */
const MAX_TITLE = 90;
const MAX_SUBTITLE = 160;
const MAX_CTA = 28;

function str(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function num(raw: unknown, min: number, max: number, dflt: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Turn anything at all into a banner that is safe to render, or null if it is
 * unusable. Callers render nothing on null — never a half-built slot.
 */
export function normalizeBanner(raw: unknown): HeroBanner | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const title = str(o.title, MAX_TITLE);
  // A slot with no headline has nothing to say and would render as an
  // anonymous image. Refuse it outright so the admin sees the error rather
  // than a mystery empty card.
  if (!title) return null;

  const ctaUrl = safeUrl(o.ctaUrl);
  const ctaLabel = str(o.ctaLabel, MAX_CTA);

  // A CTA with no destination, or a destination with no label, is not a
  // button. Rendering the label alone would produce a control that goes
  // nowhere, which is worse than no control at all.
  const usableCta = ctaUrl && ctaLabel;

  return {
    id: str(o.id, 64) || "home-hero",
    title,
    subtitle: str(o.subtitle, MAX_SUBTITLE),
    imageUrl: safeUrl(o.imageUrl),
    ctaLabel: usableCta ? ctaLabel : null,
    ctaUrl: usableCta ? ctaUrl : null,
    enabled: o.enabled !== false,
    startsAt: isoOrNull(o.startsAt),
    endsAt: isoOrNull(o.endsAt),
    priority: num(o.priority, 0, 999, 0),
    audience: (HERO_AUDIENCES as readonly string[]).includes(String(o.audience))
      ? (o.audience as HeroAudience)
      : "all",
    updatedAt: isoOrNull(o.updatedAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Should this banner show to `audience` at `now`?
 *
 * Kept separate from `normalizeBanner` so the SAME rule is applied by the
 * public API (before it sends anything to the browser) and by the component
 * (before it renders). A banner that was live when it was fetched but expired
 * while the page sat open must disappear on its own — the clock is checked at
 * render time, not only at fetch time.
 */
export function isBannerLive(
  b: HeroBanner,
  now: number,
  audience: HeroAudience = "all",
): boolean {
  if (!b.enabled) return false;
  if (b.audience !== "all" && b.audience !== audience) return false;
  if (b.startsAt && Date.parse(b.startsAt) > now) return false;
  // Exclusive upper bound, so `endsAt` can be the exact moment a new
  // campaign is due to start without the two overlapping for a frame.
  if (b.endsAt && now >= Date.parse(b.endsAt)) return false;
  return true;
}

/**
 * Pick the banner to show from a list. A disabled, out-of-window or
 * wrong-audience entry is skipped rather than returned, so the caller can
 * trust whatever comes back.
 */
export function pickBanner(
  list: unknown[],
  now: number,
  audience: HeroAudience = "all",
): HeroBanner | null {
  const live = list
    .map(normalizeBanner)
    .filter((b): b is HeroBanner => b !== null)
    .filter((b) => isBannerLive(b, now, audience))
    .sort((a, b) => b.priority - a.priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return live[0] ?? null;
}

/**
 * Countdown copy for an admin editing a slot, e.g. "Ends in 3 days".
 * Returns null when there is nothing useful to say, so the admin UI can stay
 * quiet rather than print "Ends in 0 minutes".
 */
export function scheduleSummary(b: HeroBanner, now: number): string | null {
  if (!b.startsAt && !b.endsAt) return null;
  const fmt = (ms: number) => {
    const mins = Math.round(ms / 60_000);
    if (mins < 1) return "less than a minute";
    if (mins < 60) return `${mins} min`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} hr`;
    return `${Math.round(hrs / 24)} days`;
  };
  if (b.startsAt && Date.parse(b.startsAt) > now) {
    return `Starts in ${fmt(Date.parse(b.startsAt) - now)}`;
  }
  if (b.endsAt) {
    const left = Date.parse(b.endsAt) - now;
    return left > 0 ? `Ends in ${fmt(left)}` : "Expired";
  }
  return null;
}