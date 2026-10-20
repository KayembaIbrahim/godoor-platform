/**
 * The welcome page background — an admin-customisable image.
 *
 * ── Where it lives and why ────────────────────────────────────────────────
 * `app_settings` is used rather than a dedicated table for the same reason the
 * sponsored hero banner uses it: it is proven present in production, so the
 * feature works on the day it ships with no migration to remember to run. The
 * value is small (one URL plus a couple of presentation flags), which is
 * exactly what a key/value store is for.
 *
 * ── What the admin can do ─────────────────────────────────────────────────
 *   • upload an image (published straight to the public bucket),
 *   • preview it before publishing,
 *   • publish it (the live welcome page picks it up),
 *   • replace it (upload a new one — the old one is simply superseded),
 *   • reset it (the welcome page falls back to the built-in gradient).
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 * The image URL is validated here, not at the render site: a `javascript:`
 * URL in an admin-authored string is an XSS vector, and a `data:` URL would
 * smuggle markup through `background-image`. Only `https://` and root-relative
 * `/` paths are accepted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient;

export const WELCOME_BG_KEY = "welcome-background:v1";

/**
 * One entry in the welcome background slideshow.
 *
 * `type` decides how the welcome page renders it:
 *   • `image` — a still, held for `durationMs` then the show advances;
 *   • `video` — an auto-playing, muted, looping video (the "5 second clip"
 *     case); it advances when it ends, or after `durationMs` if it is longer.
 */
export type WelcomeSlide = {
  id: string;
  type: "image" | "video";
  url: string;
  /** How long this slide is held, in milliseconds. */
  durationMs: number;
};

export type WelcomeBackground = {
  /** Public URL of the background image (the single-image, legacy shape). */
  imageUrl: string;
  /** 0–100. How strongly the image shows through the glass layer. */
  intensity: number;
  /** Whether the image is published (live) or only a draft preview. */
  published: boolean;
  updatedAt: string;
  /**
   * The slideshow. Empty means "single image mode" and the welcome page
   * falls back to `imageUrl` alone. Present means the show runs instead.
   */
  slides: WelcomeSlide[];
  /** How long each slide is held before the show advances. */
  slideDurationMs: number;
};

export const DEFAULT_WELCOME_BACKGROUND: WelcomeBackground = {
  imageUrl: "",
  intensity: 100,
  published: false,
  updatedAt: "",
  slides: [],
  slideDurationMs: 6000,
};

/** Longest a single slide may be held, so a bad value cannot pin the show. */
const MAX_SLIDE_DURATION_MS = 60_000;
const MIN_SLIDE_DURATION_MS = 1_500;
const MAX_SLIDES = 12;

/**
 * Accept only a real remote image or a path on this site.
 * Returns "" when the URL is not acceptable, so the caller falls back to the
 * default background rather than rendering something dangerous.
 */
export function sanitizeImageUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const url = raw.trim();
  if (!url) return "";
  if (url.length > 2048) return "";

  // Root-relative path on this site — e.g. "/brand/welcome.jpg".
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
 * Accept only a real remote video or a path on this site.
 * Same rules as `sanitizeImageUrl`, plus a small allow-list of video
 * extensions so a script cannot be served as a "video".
 */
export function sanitizeVideoUrl(raw: unknown): string {
  const url = sanitizeImageUrl(raw);
  if (!url) return "";
  const withoutQuery = url.split("?")[0].toLowerCase();
  const ok = [".mp4", ".webm", ".ogv", ".ogg", ".mov"].some((ext) =>
    withoutQuery.endsWith(ext),
  );
  return ok ? url : "";
}

function clampDuration(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_SLIDE_DURATION_MS, Math.min(MAX_SLIDE_DURATION_MS, Math.round(n)));
}

/** Normalise the slideshow: drop anything unsafe, cap the count. */
export function normalizeSlides(raw: unknown): WelcomeSlide[] {
  if (!Array.isArray(raw)) return [];
  const out: WelcomeSlide[] = [];
  for (const item of raw.slice(0, MAX_SLIDES)) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const type = obj.type === "video" ? "video" : "image";
    const url = type === "video" ? sanitizeVideoUrl(obj.url) : sanitizeImageUrl(obj.url);
    if (!url) continue;
    const id =
      typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : `slide-${out.length}`;
    out.push({
      id,
      type,
      url,
      durationMs: clampDuration(obj.durationMs, 6000),
    });
  }
  return out;
}

function clampIntensity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Normalise whatever is stored into a safe, complete record. */
export function normalizeWelcomeBackground(raw: unknown): WelcomeBackground {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const imageUrl = sanitizeImageUrl(obj.imageUrl);
  const slides = normalizeSlides(obj.slides);
  // A background counts as publishable when it has EITHER a single image OR
  // at least one slide — a show with slides but no image is perfectly valid.
  const hasMedia = imageUrl !== "" || slides.length > 0;
  return {
    imageUrl,
    intensity: clampIntensity(obj.intensity),
    published: Boolean(obj.published) && hasMedia,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : "",
    slides,
    slideDurationMs: clampDuration(obj.slideDurationMs, 6000),
  };
}

/** Read the stored background. Never throws. */
export async function readWelcomeBackground(sb: Sb | null): Promise<WelcomeBackground> {
  if (!sb) return { ...DEFAULT_WELCOME_BACKGROUND };
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", WELCOME_BG_KEY)
      .maybeSingle();
    if (error || !data?.value) return { ...DEFAULT_WELCOME_BACKGROUND };
    return normalizeWelcomeBackground(parseStoredValue(data.value));
  } catch {
    return { ...DEFAULT_WELCOME_BACKGROUND };
  }
}

/**
 * `app_settings.value` is a text column, but rows in that table have been
 * written both ways over time: some as a JSON *string* (`"{\"a\":1}"`) and
 * some as a raw JSON *object*. PostgREST hands back whichever shape is in the
 * column, so a naive `JSON.parse(String(value))` turns an object into the
 * string `"[object Object]"` and then throws — which silently discarded a
 * perfectly good background.
 *
 * This helper accepts every shape that can legitimately be in that column.
 */
export function parseStoredValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Write the background. Returns false when the write failed. */
export async function writeWelcomeBackground(
  sb: Sb | null,
  value: WelcomeBackground,
): Promise<boolean> {
  if (!sb) return false;
  const clean = normalizeWelcomeBackground(value);
  try {
    const { error } = await sb.from("app_settings").upsert(
      {
        key: WELCOME_BG_KEY,
        // Stored as a JSON *string*, the same shape every other row in
        // `app_settings` uses. Writing a raw object here worked by accident
        // (PostgREST coerced it) but produced a row the reader could not
        // parse, which is why publishing appeared to do nothing.
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

/** Remove the stored background — the welcome page falls back to the gradient. */
export async function clearWelcomeBackground(sb: Sb | null): Promise<boolean> {
  if (!sb) return false;
  try {
    const { error } = await sb.from("app_settings").delete().eq("key", WELCOME_BG_KEY);
    return !error;
  } catch {
    return false;
  }
}
