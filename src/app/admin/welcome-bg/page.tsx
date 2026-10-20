"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Eye,
  ImageIcon,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  Video,
} from "lucide-react";

/**
 * Admin control of the welcome page background (version 10.5.1).
 *
 * The welcome page is the first screen every visitor sees, and the brief is
 * that an admin can change it without a deploy. This page does exactly that:
 *
 *   • UPLOAD  — pick an image OR a short video; it is published to the public
 *               bucket and the URL is filled in. Nothing is written to the
 *               database yet.
 *   • SLIDES  — add several images/videos and they play as a cross-fading
 *               slideshow on the welcome page. A 5-second video clip works
 *               as one slide; it loops and the show moves on when it ends.
 *   • PREVIEW — see the show behind the glass capsule, with the intensity
 *               slider, before anyone else sees it.
 *   • PUBLISH — save it live. The welcome page reads `/api/welcome-bg` on
 *               every load, so this takes effect immediately.
 *   • REPLACE — upload a new item and publish; the old one is superseded.
 *   • RESET   — clear the stored background; the welcome page falls back to
 *               the built-in gradient.
 *
 * The URL is validated on the server (`sanitizeImageUrl` / `sanitizeVideoUrl`):
 * only `https://` and root-relative paths are accepted, because a
 * `javascript:` URL in an admin-authored string is an XSS vector and a
 * `data:` URL would smuggle markup through `background-image`.
 */

type Slide = {
  id: string;
  type: "image" | "video";
  url: string;
  durationMs: number;
};

type Background = {
  imageUrl: string;
  intensity: number;
  published: boolean;
  updatedAt: string;
  slides: Slide[];
  slideDurationMs: number;
};

const EMPTY: Background = {
  imageUrl: "",
  intensity: 100,
  published: false,
  updatedAt: "",
  slides: [],
  slideDurationMs: 6000,
};

export default function AdminWelcomeBackground() {
  const [bg, setBg] = useState<Background>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "upload" | "reset" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  // Which upload slot the next pick should fill: the single image, or a
  // new slide appended to the show.
  const uploadTarget = useRef<"image" | "slide">("slide");
  const videoTarget = useRef<"image" | "slide">("slide");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/welcome-bg", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load the current background");
        const data = (await res.json()) as { background?: Background };
        if (data.background) {
          setBg({ ...EMPTY, ...data.background, slides: data.background.slides ?? [] });
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
    window.setTimeout(() => setMsg(null), 4000);
  }

  async function uploadFile(file: File, kind: "image" | "video", target: "image" | "slide") {
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("bucket", "catalogue-images");
      form.append(
        "path",
        `welcome/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      );

      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Upload returned no URL");

      if (target === "image") {
        setBg((b) => ({ ...b, imageUrl: data.url!, published: false }));
        flash(true, "Image uploaded. Review the preview, then publish it.");
      } else {
        const slide: Slide = {
          id: `slide-${Date.now()}`,
          type: kind,
          url: data.url!,
          durationMs: kind === "video" ? 5000 : bg.slideDurationMs,
        };
        setBg((b) => ({ ...b, slides: [...b.slides, slide], published: false }));
        flash(true, `${kind === "video" ? "Video" : "Image"} added to the show.`);
      }
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  function removeSlide(id: string) {
    setBg((b) => ({ ...b, slides: b.slides.filter((s) => s.id !== id), published: false }));
  }

  function moveSlide(id: string, dir: -1 | 1) {
    setBg((b) => {
      const list = [...b.slides];
      const i = list.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return b;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...b, slides: list, published: false };
    });
  }

  async function handleSave(publish: boolean) {
    if (!bg.imageUrl && bg.slides.length === 0) {
      flash(false, "Upload an image or add a slide first.");
      return;
    }
    setBusy("save");
    try {
      const res = await fetch("/api/admin/welcome-bg", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: bg.imageUrl,
          intensity: bg.intensity,
          published: publish,
          slides: bg.slides,
          slideDurationMs: bg.slideDurationMs,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed");
      }
      const data = (await res.json()) as { background?: Background };
      if (data.background) {
        setBg((b) => ({ ...b, ...data.background, slides: data.background.slides ?? [] }));
      }
      flash(true, publish ? "Published — the welcome page is live." : "Saved as a draft preview.");
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    if (!window.confirm("Reset the welcome background to the built-in gradient?")) return;
    setBusy("reset");
    try {
      const res = await fetch("/api/admin/welcome-bg", { method: "DELETE" });
      if (!res.ok) throw new Error("Reset failed");
      setBg(EMPTY);
      flash(true, "Welcome background reset.");
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(null);
    }
  }

  const scrimOpacity = 1 - (Math.max(0, Math.min(100, bg.intensity)) / 100) * 0.72;
  const hasShow = bg.slides.length > 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
          <ImageIcon className="h-5 w-5 text-go" />
          Welcome Background
        </h1>
        <p className="mt-1 text-sm text-muted">
          Change what visitors see behind the welcome screen. Images, short
          videos, or a slideshow of both. Changes go live as soon as you
          publish — no redeploy.
        </p>
      </header>

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

          {/* A miniature of the real welcome screen: the show, the scrim the
              intensity slider controls, and the glass Explore capsule. */}
          <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-border bg-bg">
            {hasShow ? (
              bg.slides.map((s, i) => (
                <div
                  key={s.id}
                  className="absolute inset-0"
                  style={{ opacity: i === 0 ? 1 : 0 }}
                >
                  {s.type === "video" ? (
                    <video
                      src={s.url}
                      muted
                      loop
                      playsInline
                      autoPlay={i === 0}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className="h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${s.url})` }}
                    />
                  )}
                </div>
              ))
            ) : bg.imageUrl ? (
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${bg.imageUrl})` }}
              />
            ) : null}
            <div
              className="absolute inset-0 bg-bg"
              style={{ opacity: bg.imageUrl || hasShow ? scrimOpacity : 1 }}
            />
            <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/15 text-base font-bold text-go">
                G
              </div>
              <span className="font-display text-lg font-bold text-fg">GoDoor</span>
              <p className="text-center text-[10px] font-medium text-muted">
                Food, groceries, pharmacy &amp; packages across Uganda
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-2xl border border-white/25 bg-white/15 px-5 py-2 text-[11px] font-semibold text-fg backdrop-blur-2xl">
                Explore GoDoor
              </span>
            </div>
            {!bg.imageUrl && !hasShow && (
              <p className="absolute bottom-3 left-0 right-0 text-center text-[10px] text-muted">
                No image set — the welcome page uses its built-in gradient.
              </p>
            )}
          </div>

          {/* Intensity */}
          <div>
            <label className="flex items-center justify-between text-xs font-medium text-muted">
              <span>Image strength</span>
              <span className="tabular-nums text-fg">{bg.intensity}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={bg.intensity}
              onChange={(e) => {
                setBg((b) => ({ ...b, intensity: Number(e.target.value), published: false }));
              }}
              className="mt-2 w-full accent-go"
              aria-label="Background image strength"
            />
            <p className="mt-1 text-[11px] text-dim">
              Lower values let more of the image show through the glass layer.
            </p>
          </div>
        </section>

        {/* ── Controls ────────────────────────────────────────────────── */}
        <section className="space-y-4">
          {/* ── Slideshow ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border bg-surface p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <Layers className="h-4 w-4 text-go" /> Slideshow
                {hasShow && (
                  <span className="rounded-full bg-go/15 px-2 py-0.5 text-[10px] font-semibold text-go">
                    {bg.slides.length} slide{bg.slides.length === 1 ? "" : "s"}
                  </span>
                )}
              </h2>
            </div>

            {hasShow ? (
              <>
                <ul className="space-y-2">
                  {bg.slides.map((s, i) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-2.5 rounded-xl border border-border bg-bg p-2"
                    >
                      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-elevated">
                        {s.type === "video" ? (
                          <>
                            <video
                              src={s.url}
                              muted
                              loop
                              playsInline
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                              <Play className="h-3.5 w-3.5" />
                            </span>
                          </>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.url} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 text-[11px] font-semibold text-fg">
                          {s.type === "video" ? (
                            <Video className="h-3 w-3 text-go" />
                          ) : (
                            <ImageIcon className="h-3 w-3 text-go" />
                          )}
                          {s.type === "video" ? "Video" : "Image"} {i + 1}
                        </p>
                        <p className="truncate text-[10px] text-dim">
                          held {(s.durationMs / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveSlide(s.id, -1)}
                          disabled={i === 0}
                          aria-label="Move slide up"
                          className="rounded-lg border border-border px-1.5 py-1 text-[10px] text-muted transition hover:bg-elevated disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSlide(s.id, 1)}
                          disabled={i === bg.slides.length - 1}
                          aria-label="Move slide down"
                          className="rounded-lg border border-border px-1.5 py-1 text-[10px] text-muted transition hover:bg-elevated disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlide(s.id)}
                          aria-label="Remove slide"
                          className="rounded-lg border border-border p-1 text-muted transition hover:border-danger/40 hover:text-danger"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-3">
                  <label className="flex items-center justify-between text-xs font-medium text-muted">
                    <span>Time per slide</span>
                    <span className="tabular-nums text-fg">
                      {(bg.slideDurationMs / 1000).toFixed(1)}s
                    </span>
                  </label>
                  <input
                    type="range"
                    min={1500}
                    max={15000}
                    step={500}
                    value={bg.slideDurationMs}
                    onChange={(e) => {
                      setBg((b) => ({
                        ...b,
                        slideDurationMs: Number(e.target.value),
                        published: false,
                      }));
                    }}
                    className="mt-2 w-full accent-go"
                    aria-label="Time per slide"
                  />
                </div>
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted">
                No slideshow yet. Add images or a short video below and the
                welcome page will play them as a cross-fading show. A 5-second
                clip is ideal.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFile(f, "image", uploadTarget.current);
                  e.target.value = "";
                }}
              />
              <input
                ref={videoRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFile(f, "video", videoTarget.current);
                  e.target.value = "";
                }}
              />

              <button
                type="button"
                onClick={() => {
                  uploadTarget.current = "slide";
                  fileRef.current?.click();
                }}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-bg px-3 py-2 text-xs font-semibold text-fg transition hover:bg-elevated disabled:opacity-40"
              >
                {busy === "upload" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5 text-go" />
                )}
                Add image slide
              </button>

              <button
                type="button"
                onClick={() => {
                  videoTarget.current = "slide";
                  videoRef.current?.click();
                }}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-bg px-3 py-2 text-xs font-semibold text-fg transition hover:bg-elevated disabled:opacity-40"
              >
                <Clapperboard className="h-3.5 w-3.5 text-go" />
                Add video slide
              </button>
            </div>
          </div>

          {/* ── Single image ──────────────────────────────────────────── */}
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Upload className="h-4 w-4 text-go" /> Single image
          </h2>

          <button
            type="button"
            onClick={() => {
              uploadTarget.current = "image";
              fileRef.current?.click();
            }}
            disabled={busy !== null}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border px-4 py-6 text-center transition hover:border-go/50 hover:bg-go/5 disabled:opacity-50"
          >
            {busy === "upload" ? (
              <Loader2 className="h-6 w-6 animate-spin text-go" />
            ) : (
              <Upload className="h-6 w-6 text-go" />
            )}
            <span className="text-sm font-semibold text-fg">
              {busy === "upload" ? "Uploading…" : "Choose an image"}
            </span>
            <span className="text-[11px] text-muted">
              JPG, PNG or WebP. A portrait image works best on a phone.
            </span>
          </button>

          {bg.imageUrl && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Current image
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bg.imageUrl}
                alt="Current welcome background"
                className="h-28 w-full rounded-lg object-cover"
              />
              <p className="mt-1.5 break-all text-[10px] text-dim">{bg.imageUrl}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={busy !== null || (!bg.imageUrl && !hasShow)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 disabled:opacity-40"
            >
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Publish
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={busy !== null || (!bg.imageUrl && !hasShow)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-fg transition hover:bg-elevated disabled:opacity-40"
            >
              Save as draft
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted transition hover:bg-elevated hover:text-fg disabled:opacity-40"
            >
              {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Reset
            </button>
          </div>

          <div className="rounded-xl border border-border bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
            <p className="mb-1 font-semibold text-fg">How it works</p>
            <p>
              Uploading fills in the image and shows a preview — the live page is
              unchanged until you press <b>Publish</b>. A draft is never shown to
              visitors. <b>Reset</b> clears everything and the welcome page goes
              back to its built-in gradient.
            </p>
            {bg.updatedAt && (
              <p className="mt-1.5 text-dim">
                Last change: {new Date(bg.updatedAt).toLocaleString()}
                {bg.published ? " · live" : " · draft"}
              </p>
            )}
          </div>
        </section>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
    </div>
  );
}
