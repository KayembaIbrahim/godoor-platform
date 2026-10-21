"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SignInForm, type SignInMode } from "@/components/SignInForm";
import { Logo } from "@/components/Logo";
import { type WelcomeBackground } from "@/components/WelcomeScreen";

/**
 * Full-screen sign-in page shell with the admin-published welcome background.
 *
 * Reuses the same background logic as `WelcomeScreen` so the sign-in page
 * feels like part of the app shell rather than a plain white page:
 *   - Slideshow support (images + videos, auto-advance)
 *   - Intensity-driven scrim for legibility
 *   - Gradient fallback when no background is published
 *
 * The background is pre-fetched on the server (in `/signin/page.tsx`) and
 * passed as a prop, so the first paint already has the artwork — no flash
 * of the fallback gradient.
 */
export function SigninShell({
  background = null,
  mode = "login",
  next,
}: {
  background?: WelcomeBackground | null;
  mode?: SignInMode;
  next?: string;
}) {
  const slides = useMemo(() => background?.slides ?? [], [background?.slides]);
  const hasShow = slides.length > 0;
  const [slideIndex, setSlideIndex] = useState(0);
  const intensity = Math.max(0, Math.min(100, background?.intensity ?? 100)) / 100;

  // Advance slideshow (same logic as WelcomeScreen)
  useEffect(() => {
    if (!hasShow) return;
    const current = slides[slideIndex];
    if (!current) return;

    if (current.type === "video") {
      const t = window.setTimeout(
        () => setSlideIndex((i) => (i + 1) % slides.length),
        Math.max(current.durationMs, 5000),
      );
      return () => window.clearTimeout(t);
    }

    const t = window.setTimeout(
      () => setSlideIndex((i) => (i + 1) % slides.length),
      current.durationMs,
    );
    return () => window.clearTimeout(t);
  }, [hasShow, slideIndex, slides]);

  return (
    <div className="isolate relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-bg">
      {/* ── Background ─────────────────────────────────────────────────── */}
      {hasShow ? (
        slides.map((s, i) => (
          <div
            key={s.id}
            className="absolute inset-0 -z-20 transition-opacity duration-[1200ms] ease-in-out"
            style={{ opacity: i === slideIndex ? 1 : 0 }}
            aria-hidden="true"
          >
            {s.type === "video" ? (
              <video
                src={s.url}
                muted
                loop
                playsInline
                autoPlay
                preload={i === slideIndex ? "auto" : "none"}
                onEnded={() => setSlideIndex((n) => (n + 1) % slides.length)}
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
      ) : background?.imageUrl ? (
        <div
          className="absolute inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${background.imageUrl})` }}
          aria-hidden="true"
        />
      ) : (
        <div
          className="absolute inset-0 -z-20 bg-gradient-to-br from-go/10 via-surface to-surface"
          aria-hidden="true"
        />
      )}

      {/* Scrim — keeps the centered form legible over any image, driven by admin's intensity */}
      {(hasShow || background?.imageUrl) && (
        <div
          className="absolute inset-0 -z-10 bg-bg"
          style={{ opacity: 1 - intensity * 0.72 }}
          aria-hidden="true"
        />
      )}

      {/* ── Centered content ───────────────────────────────────────────── */}
      <div className="relative flex w-full max-w-md flex-1 flex-col items-center px-4 py-10">
        {/* The logo, CENTRED, above the form.

            It used to sit at the top-LEFT of the form card, which made the
            page read as a form with a logo stuck to it. Centring it — with
            the wordmark under the mark — turns the top of the page into a
            proper masthead, so the sign-in screen looks like the app's front
            door rather than a dialog that lost its container.

            The mark sits on its own raised disc: a lit sphere with a cast
            shadow, so it has depth against the artwork behind it. */}
        <Link
          href="/"
          aria-label="GoDoor home"
          className="group mb-6 flex flex-col items-center gap-3 transition-transform active:scale-[0.97]"
        >
          <span className="relative grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-surface to-surface-2 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.5),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-border/60 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105">
            <Logo size="lg" showWordmark={false} />
            {/* The lit rim across the top of the disc — the highlight that
                makes the mark read as a lit sphere rather than a flat
                cut-out. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-full bg-gradient-to-b from-white/30 to-transparent"
            />
          </span>
          <span className="font-display text-3xl font-bold tracking-tight text-fg">
            GoDoor
          </span>
        </Link>

        {/* Sign-in form — mode/next come from URL searchParams (read on the server) */}
        <SignInForm mode={mode} next={next} />

        {/* A way back out — the sign-in page is a full page, so a visitor who
            opened it by accident needs a way to the app without signing in. */}
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-go"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to GoDoor
        </Link>
      </div>
    </div>
  );
}