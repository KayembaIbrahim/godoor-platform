/**
 * The greeting card's background artwork — admin-customisable, image or GIF.
 *
 * ── Where it lives ─────────────────────────────────────────────────────────
 * `app_settings`, the same key/value store the welcome-page background uses.
 * It is proven present in production, so this feature works on the day it
 * ships with no migration to remember to run, and the value is small — one
 * URL and a couple of presentation flags — which is exactly what a key/value
 * store is for.
 *
 * ── Images AND GIFs ────────────────────────────────────────────────────────
 * The brief asks for "image or GIF". A GIF is served from the same public
 * bucket as any other upload and is referenced by URL exactly like a JPEG,
 * so there is no separate code path for it: the browser animates it on its
 * own. What we DO have to be careful about is that an animated GIF is a
 * large file and a heavy repaint on a low-end Android phone — so the admin
 * is warned about file size at upload time, and the card renders the artwork
 * behind a `will-change: transform` layer rather than re-laying out on every
 * frame.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 * The URL is validated HERE, not at the render site. A `javascript:` URL in an
 * admin-authored string is an XSS vector, and a `data:` URL would smuggle
 * markup through `background-image`. Only `https://` and root-relative `/`
 * paths are accepted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStoredValue } from "./welcome-bg-server";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, extensionHint } from "./media-url";

type Sb = SupabaseClient;

export const GREETING_BG_KEY = "greeting-background:v1";

/**
 * The greeting card's background configuration.
 *
 * `imageUrl` may point at a still image OR an animated GIF — the two are the
 * same thing as far as the browser is concerned. `isGif` is stored purely so
 * the admin UI can label what it published and the card can skip the
 * "static art" affordances; it never changes how the URL is fetched.
 */
export type GreetingBackground = {
  /** Public URL of the artwork (JPEG, PNG, WebP, GIF …). */
  imageUrl: string;
  /** 0–100. How strongly the artwork shows through the scrim. */
  intensity: number;
  /** Whether the artwork is published (live) or only a draft preview. */
  published: boolean;
  /** True when the uploaded file was a GIF. */
  isGif: boolean;
  /**
   * How the artwork should be played.
   *
   * `image` covers stills AND animated GIFs — the browser animates a GIF on
   * its own, so it needs no special handling. `video` means a real video
   * file, which the card plays in a `<video>` element instead of painting it
   * as a background (a background-image cannot play video at all).
   */
  mediaType: "image" | "video";
  /** When the record was last written (ISO 8601). */
  updatedAt: string;
};

export const DEFAULT_GREETING_BACKGROUND: GreetingBackground = {
  imageUrl: "",
  intensity: 100,
  published: false,
  isGif: false,
  mediaType: "image",
  updatedAt: "",
};

/**
 * Accept only a real remote image or a path on this site.
 * Returns "" when the URL is not acceptable, so the caller falls back to the
 * default artwork rather than rendering something dangerous.
 */
export function sanitizeArtworkUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const url = raw.trim();
  if (!url) return "";
  if (url.length > 2048) return "";

  // Root-relative path on this site — e.g. "/brand/greeting.gif".
  if (url.startsWith("/") && !url.startsWith("//")) {
    if (url.includes("..")) return "";
    return url;
  }

  // Absolute https URL.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * Does this URL point at an animated GIF?
 *
 * Only the extension is checked — the server does not download the file to
 * sniff its magic bytes, because that would mean fetching an arbitrary
 * admin-supplied URL from the server. The extension is enough here: the
 * label on the admin page is a convenience, not a security control.
 */
export function looksLikeGif(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return extensionHint(raw) === "gif";
}

/**
 * Is this URL an artwork type we know how to render?
 *
 * Two cases are rejected outright:
 *   • a URL whose path clearly points at a document or a web page
 *     (`.html`, `.pdf`, `.php` …) — those would silently fail to paint, and a
 *     share page is the single most common mistake when pasting a link;
 *   • anything that is not `https:` — that is the real security control.
 *
 * A URL with NO extension at all is ACCEPTED. Plenty of real hosts serve
 * images from opaque paths (`https://cdn.example.com/i/8f3a91`), and refusing
 * them would break a link that works perfectly well in the browser. The
 * admin's own preview is the honest test of whether the link is good, and the
 * UI says so.
 */
export function isSupportedArtwork(raw: unknown): boolean {
  const url = sanitizeArtworkUrl(raw);
  if (!url) return false;
  const ext = extensionHint(url);
  if (!ext) return true; // Unknown but plausible — let the browser decide.
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Is this URL a video file the card can play in a `<video>` element? */
export function isVideoArtwork(raw: unknown): boolean {
  const url = sanitizeArtworkUrl(raw);
  if (!url) return false;
  return VIDEO_EXTENSIONS.includes(extensionHint(url));
}

function clampIntensity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Normalise whatever is stored into a safe, complete record.
 *
 * `mediaType` is derived from the URL's content kind rather than being
 * purely client-side: the card renders an animated GIF as a still (the browser
 * does it), so GIFs and video both need to be distinguished, but everything
 * else — a static JPEG with no extension, or an opaque-path CDN link — falls
 * through to the "image" case.
 */
export function normalizeGreetingBackground(raw: unknown): GreetingBackground {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const imageUrl = sanitizeArtworkUrl(obj.imageUrl);
  const ext = extensionHint(imageUrl);
  const hasMedia = imageUrl !== "";
  return {
    imageUrl,
    intensity: clampIntensity(obj.intensity),
    published: Boolean(obj.published) && hasMedia,
    isGif: ext === "gif",
    // A real GIF counts as an IMAGE (the browser animates it on its own through
    // `background-image`), so only genuine video files route to the `<video>`
    // element. Everything else — a static JPEG with no extension, or an
    // opaque-path CDN link — falls through to the image case.
    mediaType: hasMedia && !ext ? "image" : ext === "gif" ? "image" : isVideoArtwork(imageUrl) ? "video" : "image",
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : "",
  };
}

/** Read the stored background. Never throws. */
export async function readGreetingBackground(sb: Sb | null): Promise<GreetingBackground> {
  if (!sb) return { ...DEFAULT_GREETING_BACKGROUND };
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", GREETING_BG_KEY)
      .maybeSingle();
    if (error || !data?.value) return { ...DEFAULT_GREETING_BACKGROUND };
    return normalizeGreetingBackground(parseStoredValue(data.value));
  } catch {
    return { ...DEFAULT_GREETING_BACKGROUND };
  }
}

/** Write the background. Returns false when the write failed. */
export async function writeGreetingBackground(
  sb: Sb | null,
  value: GreetingBackground,
): Promise<boolean> {
  if (!sb) return false;
  const clean = normalizeGreetingBackground(value);
  try {
    const { error } = await sb.from("app_settings").upsert(
      {
        key: GREETING_BG_KEY,
        // Stored as a JSON *string*, the same shape every other row in
        // `app_settings` uses. Writing a raw object here worked by accident
        // (PostgREST coerced it) but produced a row the reader could not
        // parse — which is exactly the bug that made the welcome-page
        // background look like publishing did nothing.
        value: JSON.stringify(clean),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    return !error;
  } catch {
    return false;
  }
}

/** Remove the stored background — the card falls back to the built-in art. */
export async function clearGreetingBackground(sb: Sb | null): Promise<boolean> {
  if (!sb) return false;
  try {
    const { error } = await sb.from("app_settings").delete().eq("key", GREETING_BG_KEY);
    return !error;
  } catch {
    return false;
  }
}
