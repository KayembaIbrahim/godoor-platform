"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Eye,
  Gauge,
  ImageIcon,
  Link2,
  Loader2,
  Save,
  RotateCcw,
  Upload,
} from "lucide-react";
import { explainMediaLink, isUsableMediaLink, isVideoLink } from "@/lib/media-url";

/**
 * Admin control of the greeting card's background artwork (version 10.5.1).
 *
 * The greeting is the first thing every signed-in user sees on their own home
 * screen — customer, rider and business owner alike. This page lets an admin
 * change it without a deploy:
 *
 *   • UPLOAD — pick an image OR a GIF (animated); it is published to the public
 *               bucket and the URL is filled in. A short looping video works as
 *               well — choose the `.mp4` path when uploading — and the card
 *               renders it auto-playing and muted.
 *   • PREVIEW — see what visitors see behind the greeting text, with the
 *               intensity slider so you can tune how strongly the art shows
 *               through the scrim.
 *   • PUBLISH — save it live. Every screen renders `/api/greeting-bg` on boot,
 *               so this takes effect immediately for everyone.
 *   • REPLACE — upload a new item and publish; the old one is superseded.
 *   • RESET   — clear the stored artwork; the card falls back to its built-in
 *               gradient.
 *
 * The URL is validated on the SERVER (`sanitizeArtworkUrl`): only `https://`
 * and root-relative paths are accepted, because a `javascript:` URL in an
 * admin-authored string is an XSS vector and a `data:` URL would smuggle
 * markup through `background-image`.
 *
 * Uploading a GIF makes the card animate on every signed-in screen; uploading a
 * heavy JPEG makes that same animation cost more per frame. Both are valid, and
 * a 3 MB GIF is still fine on the vast majority of phones. The preview warns about
 * file size when it detects a GIF.
 */

type Background = {
  imageUrl: string;
  intensity: number;
  published: boolean;
  isGif?: boolean;
  mediaType?: "image" | "video";
};

const EMPTY: Background = {
  imageUrl: "",
  intensity: 100,
  published: false,
  isGif: false,
  mediaType: "image",
};

export default function AdminGreetingBackground() {
  const [bg, setBg] = useState<Background>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "upload" | "reset" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // A directly-pasted link, kept separate from the upload flow so the two
  // never fight over the same state.
  const [urlDraft, setUrlDraft] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/greeting-bg", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load the current background");
        const data = (await res.json()) as { background?: Background };
        if (data.background) {
          setBg({ ...EMPTY, ...data.background });
        }
      } catch (e) {
        setMsg({
          ok: false,
          text: e instanceof Error ? e.message : "Could not load the current background",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    window.setTimeout(() => setMsg(null), 4500);
  }

  async function uploadFile(file: File) {
    // Warn about large files early — a 40 MB GIF is still playable but will
    // cause jank; we want the admin to know before they publish.
    const gif = file.name.toLowerCase().endsWith(".gif");
    if ((gif && file.size > 6 * 1024 * 1024) || (!gif && file.size > 8 * 1024 * 1024)) {
      flash(false, `${gif ? "GIF is over 6 MB — heavy for a low-end phone." : "Image is over 8 MB — consider compressing."}`);
      return;
    }

    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("bucket", "catalogue-images");
      form.append(
        "path",
        `greeting/${Date.now()}-${file.name.replace(/[^a-zA-Z0-_.-]/g, "_")}`,
      );

      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Upload returned no URL");

      const uploaded = data.url;
      const video = isVideoLink(uploaded);
      setBg((b) => ({
        ...b,
        imageUrl: uploaded,
        isGif: !video && /\.gif(\?|#|$)/i.test(uploaded),
        mediaType: video ? "video" : "image",
        published: false,
      }));
      flash(true, "Artwork uploaded. Review the preview, then publish.");
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Apply a directly-pasted artwork link.
   *
   * The admin may either UPLOAD a file (we publish it to our own bucket and
   * link it) or point at media that already lives somewhere else — a CDN, a
   * public R2 bucket, a Terabox direct-download link. Both paths end up in the
   * same place, so the admin is never forced into one way of working.
   *
   * The check here is only for the admin's benefit (an immediate, specific
   * message instead of a generic "Save failed"). The server re-validates the
   * URL authoritatively before storing anything.
   */
  function applyUrl() {
    const raw = urlDraft.trim();
    const problem = explainMediaLink(raw);
    if (problem) {
      flash(false, problem);
      return;
    }
    if (!isUsableMediaLink(raw)) {
      flash(false, "That link cannot be used. Use a direct https:// link to an image or GIF.");
      return;
    }
    setBg((b) => ({
      ...b,
      imageUrl: raw,
      isGif: !isVideoLink(raw) && /\.gif(\?|#|$)/i.test(raw),
      mediaType: isVideoLink(raw) ? "video" : "image",
      published: false,
    }));
    flash(true, "Artwork set from the link. Press Publish to make it live.");
  }

  function handleSave(publish: boolean) {
    if (!bg.imageUrl) {
      flash(false, "Upload an image or a GIF first.");
      return;
    }
    setBusy("save");
    fetch("/api/admin/greeting-bg", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: bg.imageUrl,
        intensity: bg.intensity,
        published: publish,
        isGif: Boolean(bg.isGif),
        mediaType: bg.mediaType === "video" ? "video" : "image",
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.background) setBg({ ...EMPTY, ...data.background });
      })
      .then(() => flash(true, publish ? "Published — the greeting is live." : "Saved as a draft."))
      .catch((e) => flash(false, e instanceof Error ? e.message : "Save failed"))
      .finally(() => setBusy(null));
  }

  async function handleReset() {
    if (!window.confirm("Reset the greeting background to the built-in gradient?")) return;
    setBusy("reset");
    try {
      const res = await fetch("/api/admin/greeting-bg", { method: "DELETE" });
      if (!res.ok) throw new Error("Reset failed");
      setBg(EMPTY);
      flash(true, "Greeting background reset.");
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(null);
    }
  }

  const scrimOpacity = 1 - (Math.max(0, Math.min(100, bg.intensity)) / 100) * 0.72;
  const hasArt = bg.imageUrl !== "";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
          <ImageIcon className="h-5 w-5 text-go" />
          Greeting Card Background
        </h1>
        <p className="mt-1 text-sm text-muted">
          Change what every signed-in user sees on their home screen — their
          first card of the day, greeting them by name over custom artwork.
        </p>
      </header>

      {loading && (
        <div className="flex items-center justify-center rounded-xl bg-elevated p-6 text-sm text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {msg && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs ${
            msg.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
          }`}
        >
          {msg.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {msg.text}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Preview ─────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Eye className="h-4 w-4 text-go" /> Preview
          </h2>

          {/* A miniature of the real card: the artwork, the scrim, and the
              silhouette of the greeting text that sits over it. */}
          <div
            className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-bg"
          >
            {hasArt ? (
              <>
                {/* A video cannot be painted as a background-image — it has to
                    be a real <video> element, exactly as the card renders it
                    live. Previewing it any other way would show the admin a
                    blank box and send them looking for a bug that is not
                    there. */}
                {bg.mediaType === "video" ? (
                  <video
                    src={bg.imageUrl}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(${bg.imageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                )}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-bg"
                  style={{ opacity: hasArt ? scrimOpacity : 1 }}
                />
                <div className="relative flex flex-col items-center justify-center gap-2 px-8 pb-6 pt-8 text-center">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
                    GoDoor
                  </span>
                  <span className="font-display text-lg font-bold text-fg">Hello!</span>
                  <span className="font-display text-base font-bold text-on-ink-muted">
                    Good morning
                  </span>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary via-purple to-primary/60">
                <Clapperboard className="h-8 w-8 opacity-40" />
              </div>
            )}
          </div>
        </section>

        {/* ── Controls ─────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Upload className="h-4 w-4 text-go" /> Upload Artwork
          </h2>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            className="group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border bg-elevated py-8 text-center transition hover:border-go hover:bg-go/5 active:scale-[0.99]"
          >
            <Upload className="h-6 w-6 text-muted group-hover:text-go" />
            <div>
              <p className="text-xs font-medium text-muted">
                {hasArt ? "Replace the artwork" : "Pick an image or a GIF"}
              </p>
              <p className="text-[11px] text-muted">
                PNG, JPG, WebP, AVIF, GIF or short video
              </p>
            </div>
            {!hasArt && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-1 text-[10px] font-medium text-go underline underline-offset-2 opacity-0 transition group-hover:opacity-100"
              >
                Choose file
              </button>
            )}
            {hasArt && <span className="text-[10px] text-muted">Replacing…</span>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.currentTarget.value = "";
            }}
          />

          {/* ── Or paste a direct link ───────────────────────────────────
              Upload and link are EQUAL options here: the admin can host the
              artwork anywhere (their own CDN, a public bucket, a Terabox
              direct-download link) and paste the link, or upload the file and
              let GoDoor host it. */}
          <div className="rounded-2xl border border-border bg-elevated p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-go" />
              <span className="text-[11px] font-semibold text-fg">
                Or paste a direct link
              </span>
            </div>

            <input
              type="url"
              inputMode="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyUrl();
                }
              }}
              placeholder="https://example.com/artwork.gif"
              className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 font-mono text-[11px] text-fg outline-none transition focus:border-go/50 focus:ring-1 focus:ring-go/30"
              aria-label="Direct artwork link"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={applyUrl}
                disabled={busy !== null || !urlDraft.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-go px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-go-2 disabled:opacity-40"
              >
                <Link2 className="h-3 w-3" />
                Apply link
              </button>
              {urlDraft && (
                <button
                  type="button"
                  onClick={() => setUrlDraft("")}
                  className="text-[10px] font-medium text-muted underline underline-offset-2 hover:text-fg"
                >
                  Clear
                </button>
              )}
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-dim">
              Use the <b>direct file link</b>, not a share page. A Terabox
              share page (<code>terabox.com/s/…</code>) is a web page, not an
              image, so it will never appear — use Terabox&apos;s
              &quot;Direct download&quot; link instead.
            </p>
          </div>

          {/* What is currently live. */}
          {bg.imageUrl && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Current artwork
              </p>
              <p className="break-all text-[10px] text-dim">{bg.imageUrl}</p>
              <div className="mt-1 flex justify-between text-[10px]">
                <span className="font-medium text-muted">
                  {bg.mediaType === "video"
                    ? "video"
                    : bg.isGif
                      ? "animated GIF"
                      : "static image"}
                </span>
                <span>{bg.published ? "Live" : "Draft"}</span>
              </div>
            </div>
          )}

          {/* Intensity slider — admin tunes how much the art shows through the
              scrim. Lower = more scrim, warmer greeting. */}
          <div className="space-y-2 rounded-2xl border border-border bg-elevated p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted" />
                <label htmlFor="intensity" className="text-xs font-medium text-fg">
                  Art strength
                </label>
                <span id="intensity" className="text-xs font-semibold tabular-nums text-go">
                  {bg.intensity}%
                </span>
              </div>
              <span className="text-[10px] text-muted">
                {bg.intensity === 100 ? "Full" : bg.intensity < 40 ? "Dimmer" : "Moderate"}
              </span>
            </div>
            <input
              id="intensity"
              type="range"
              min={0}
              max={100}
              value={bg.intensity}
              onChange={(e) => setBg((b) => ({ ...b, intensity: Number(e.target.value) }))}
              className="w-full accent-[rgb(var(--rgb-primary))]"
            />
          </div>

          {/* Publish / Save buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasArt || busy !== null}
              onClick={() => handleSave(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white transition disabled:opacity-40 active:scale-[0.99]"
            >
              <Save className="h-3.5 w-3.5" /> Publish live
            </button>
            <button
              type="button"
              disabled={!hasArt || busy !== null}
              onClick={() => handleSave(false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-elevated px-4 py-2.5 text-xs font-semibold text-fg transition disabled:opacity-40 active:scale-[0.99]"
            >
              <Save className="h-3.5 w-3.5" /> Preview draft
            </button>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleReset}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-danger/10 px-4 py-2.5 text-xs font-semibold text-danger transition disabled:opacity-40 active:scale-[0.99]"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
          </button>
        </section>
      </div>
    </div>
  );
}
