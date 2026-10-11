/**
 * Flyer / announcement popup logic — pure, with no database or React.
 *
 * Split out deliberately so the rules that decide *whether a popup interrupts
 * someone* can be unit-tested in plain Node. That matters more than it looks:
 * this file is the only thing standing between a marketing campaign and every
 * user of the app, and it is the part nobody can see failing until customers
 * complain.
 *
 * Three rules shape everything here:
 *
 *  1. A campaign is authored by an admin and rendered into an `href` and an
 *     `img src`. So every URL is scheme-checked. `javascript:` in a title is
 *     not a typo to be escaped later, it is an XSS vector, and the only place
 *     it can be stopped is here.
 *  2. Dismissal has to survive a reload. A popup that returns after the user
 *     closed it is worse than no popup at all — it teaches people to ignore
 *     the control, and then the control stops working for real messages too.
 *  3. Nothing shows to the wrong audience or outside its schedule. An expired
 *     campaign is not "probably fine to show", it is a lie on the home screen.
 */

export const CAMPAIGN_TONES = ["brand", "navy", "purple", "success", "gold"] as const;
export type CampaignTone = (typeof CAMPAIGN_TONES)[number];

export const CAMPAIGN_AUDIENCES = ["all", "customer", "rider", "business"] as const;
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];

export type Campaign = {
  id: string;
  title: string;
  body: string;
  /** Absolute http(s) URL or a `/`-relative path. Never a `javascript:` URL. */
  imageUrl: string | null;
  ctaLabel: string | null;
  /** Absolute http(s) URL or a `/`-relative path. Never a `javascript:` URL. */
  ctaUrl: string | null;
  tone: CampaignTone;
  audience: CampaignAudience;
  enabled: boolean;
  /** ISO 8601, inclusive. Null = no lower bound. */
  startsAt: string | null;
  /** ISO 8601, exclusive. Null = no upper bound. */
  endsAt: string | null;
  /** Higher wins when several campaigns are live at once. */
  priority: number;
  /** How long one dismissal suppresses this campaign. 0 means forever. */
  dismissDays: number;
  updatedAt: string;
};

export const DISMISS_KEY = "godoor:campaigns:dismissed:v1";

/** Hard ceilings so a fat-fingered admin cannot lock the UI. */
const MAX_TITLE = 120;
const MAX_BODY = 600;
const MAX_CTA = 40;

/* ────────────────────────────────────────────────────────────────────────────
 * URL safety
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Accept only what can be safely put in `href` / `src`.
 *
 * Relative paths are fine (they stay on our own origin). Absolute URLs must be
 * http or https. Everything else — `javascript:`, `data:`, `vbscript:`, and the
 * `//evil.com` protocol-relative form which silently inherits a scheme from the
 * page — is rejected by returning null, and the caller drops the field rather
 * than rendering a broken control.
 */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  // Relative path: must start with a single slash and not "//".
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

/** Uppercase, spaces and punctuation collapsed to `-`, so ids stay URL-safe. */
export function slugify(raw: unknown, fallback = "campaign"): string {
  if (typeof raw !== "string") return fallback;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || fallback;
}

function str(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function num(raw: unknown, min: number, max: number, dflt: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Turn anything at all into a valid campaign, or null if it is unusable.
 *
 * Coerces rather than validates: an admin editing a form should not be able to
 * lose a whole campaign to one malformed field, and the worst case for a bad
 * title is a slightly wrong title.
 */
export function sanitizeCampaign(raw: unknown, nowMs = Date.now()): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const title = str(r.title, MAX_TITLE);
  // A popup with no title and no image has nothing to say.
  if (!title && !safeUrl(r.imageUrl)) return null;

  const tone = (CAMPAIGN_TONES as readonly string[]).includes(String(r.tone))
    ? (r.tone as CampaignTone)
    : "brand";
  const audience = (CAMPAIGN_AUDIENCES as readonly string[]).includes(String(r.audience))
    ? (r.audience as CampaignAudience)
    : "all";

  return {
    id: slugify(r.id ?? title),
    title,
    body: str(r.body, MAX_BODY),
    imageUrl: safeUrl(r.imageUrl),
    ctaLabel: str(r.ctaLabel, MAX_CTA) || null,
    // A CTA with no label is unusable; a label with no URL is a dead button.
    ctaUrl: safeUrl(r.ctaUrl),
    tone,
    audience,
    enabled: r.enabled !== false,
    startsAt: isoOrNull(r.startsAt),
    endsAt: isoOrNull(r.endsAt),
    priority: num(r.priority, -100, 100, 0),
    dismissDays: num(r.dismissDays, 0, 365, 7),
    updatedAt: isoOrNull(r.updatedAt) ?? new Date(nowMs).toISOString(),
  };
}

/** Sanitize a stored array, dropping anything unusable rather than failing. */
export function sanitizeCampaigns(raw: unknown, nowMs = Date.now()): Campaign[] {
  if (!Array.isArray(raw)) return [];
  const out: Campaign[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const c = sanitizeCampaign(item, nowMs);
    // A duplicate id would make dismissal ambiguous — first one wins.
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Scheduling
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Is this campaign switched on, in its window, and for this role?
 *
 * A signed-out visitor (`role` null) only ever sees `all` campaigns. That is a
 * deliberate choice over the more forgiving "assume customer": we genuinely do
 * not know who is looking, and a rider who just signed out should not be shown a
 * new-customer offer. The client and the API both call this with the same
 * convention, so the two halves cannot drift apart.
 */
export function isCampaignLive(c: Campaign, role: string | null, nowMs: number): boolean {
  if (!c.enabled) return false;
  if (c.audience !== "all" && c.audience !== (role ?? "")) return false;
  const now = new Date(nowMs).toISOString();
  // startsAt is inclusive, endsAt is exclusive, so back-to-back campaigns
  // cannot both claim the exact boundary second.
  if (c.startsAt && now < c.startsAt) return false;
  if (c.endsAt && now >= c.endsAt) return false;
  return true;
}

/**
 * The campaigns to show right now, most important first.
 *
 * Only the top one is rendered at a time — stacking modals is how you build a
 * popup people learn to dismiss without reading.
 */
export function resolveActiveCampaigns(
  all: Campaign[],
  role: string | null,
  nowMs: number = Date.now(),
): Campaign[] {
  return all
    .filter((c) => isCampaignLive(c, role, nowMs))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Tie-break on recency so the newest of two equal campaigns wins.
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dismissal
 * ────────────────────────────────────────────────────────────────────────── */

export type Dismissal = { id: string; at: number };
export type Dismissals = Record<string, number>;

/**
 * Is this campaign suppressed right now?
 *
 * A dismissal expires so that re-running a campaign months later actually
 * reaches people. `dismissDays: 0` means the admin wants it gone for good.
 */
export function isDismissed(map: Dismissals, c: Campaign, nowMs: number): boolean {
  const at = map[c.id];
  if (typeof at !== "number") return false;
  if (c.dismissDays <= 0) return true;
  return nowMs - at < c.dismissDays * 86_400_000;
}

export function dismiss(map: Dismissals, c: Campaign, nowMs: number): Dismissals {
  return { ...map, [c.id]: nowMs };
}

/** Drop entries old enough that no campaign could still be using them. */
export function pruneDismissals(map: Dismissals, nowMs: number, maxAgeDays = 365): Dismissals {
  const cutoff = nowMs - maxAgeDays * 86_400_000;
  const out: Dismissals = {};
  for (const [id, at] of Object.entries(map)) {
    if (typeof at === "number" && at <= nowMs && at >= cutoff) out[id] = at;
  }
  return out;
}

/**
 * Read the dismissal map defensively.
 *
 * localStorage is user-writable, so this must never throw and never trust the
 * shape. Corrupt data means "nothing dismissed", which at worst re-shows one
 * popup — far better than a render crash on the home screen.
 */
export function readDismissals(raw: string | null): Dismissals {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Dismissals = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[slugify(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** The campaign to render right now, or null. */
export function pickCampaign(
  all: Campaign[],
  role: string | null,
  dismissed: Dismissals,
  nowMs: number = Date.now(),
): Campaign | null {
  return resolveActiveCampaigns(all, role, nowMs).find((c) => !isDismissed(dismissed, c, nowMs)) ?? null;
}
