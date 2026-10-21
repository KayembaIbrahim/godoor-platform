"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Compass, ShieldCheck, Wallet, Clock } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useHydrated } from "@/lib/use-hydrated";
import { useSession, roleHomePath } from "@/lib/session-store";

/**
 * The GoDoor welcome screen — app-style entry point (version 10.5.1).
 *
 * ── Why this is a separate component from the page ─────────────────────────
 * `src/app/page.tsx` is a SERVER component: it reads the published welcome
 * background from the database and hands it to this one as
 * `initialBackground`. Because a client component is still server-rendered for
 * its first paint, the background image is present in the HTML the browser
 * receives — the visitor sees the artwork immediately instead of staring at
 * a blank gradient while a fetch is in flight.
 *
 * That mattered in practice: the background used to be fetched from
 * `/api/welcome-bg` after mount, so on a slow phone the first thing on
 * screen was the fallback gradient, and the admin's uploaded artwork looked
 * like it had "not taken effect" even though it was published correctly.
 *
 * The client fetch is KEPT as well. It is how a background published while
 * the tab was already open reaches the screen without a reload, and it costs
 * one small, cache-disabled request.
 */

export type WelcomeSlide = {
  id: string;
  type: "image" | "video";
  url: string;
  durationMs: number;
};

export type WelcomeBackground = {
  imageUrl?: string | null;
  intensity?: number;
  slides?: WelcomeSlide[];
  slideDurationMs?: number;
};

export function WelcomeScreen({
  initialBackground = null,
}: {
  initialBackground?: WelcomeBackground | null;
}) {
  const { onboarded, role } = useSession();
  /* The session lives in localStorage, so the server renders the "Sign in"
     pair while the client knows on its very first render whether anyone is
     signed in. The two trees would disagree, React would throw #418, and it
     would throw away the whole server-rendered page — artwork included. Only
     swap to the dashboard link once React has hydrated; the layout effect
     behind `useHydrated` flips this before the browser paints. */
  const hydrated = useHydrated();
  /* `hydrated ? onboarded : false` — NOT `hydrated && onboarded`.
     The session store rehydrates synchronously from localStorage, so
     `onboarded` is already `true` on the client's first render. Combining
     the two with `&&` would make the client's first render disagree with
     the server's and React would discard the server-rendered artwork. */
  const showDashboard = hydrated ? onboarded : false;

  // The published welcome background. Seeded from the server so the first
  // paint already has the artwork in it; the fetch below refreshes it.
  const [bg, setBg] = useState<WelcomeBackground | null>(initialBackground);

  // Which slide of the show is on screen.
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/welcome-bg", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { background?: WelcomeBackground };
        if (alive && data.background) setBg(data.background);
      } catch {
        /* keep whatever the server already rendered */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const slides = useMemo(() => bg?.slides ?? [], [bg?.slides]);
  const hasShow = slides.length > 0;

  // Advance the show. A video slide advances when it ends; an image slide
  // is held for its duration. The timer is keyed on the slide so changing
  // slides restarts the clock.
  useEffect(() => {
    if (!hasShow) return;
    const current = slides[slideIndex];
    if (!current) return;

    if (current.type === "video") {
      // The <video> element drives its own advance via onEnded; but if the
      // browser blocks autoplay we still want the show to keep moving.
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

  const intensity = Math.max(0, Math.min(100, bg?.intensity ?? 100)) / 100;

  return (
    <div className="isolate relative flex min-h-[100dvh] flex-col overflow-hidden bg-bg">
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
      ) : bg?.imageUrl ? (
        <div
          className="absolute inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${bg.imageUrl})` }}
          aria-hidden="true"
        />
      ) : (
        <div
          className="absolute inset-0 -z-20 bg-gradient-to-br from-go/10 via-surface to-surface"
          aria-hidden="true"
        />
      )}

      {hasShow || bg?.imageUrl ? (
        <>
          {/* Scrim — keeps the glass capsule legible over any image, and the
              opacity is driven by the admin's intensity slider. */}
          <div
            className="absolute inset-0 -z-10 bg-bg"
            style={{ opacity: 1 - intensity * 0.72 }}
            aria-hidden="true"
          />
        </>
      ) : null}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo size="lg" showWordmark={false} />
          <span className="font-display text-3xl font-bold tracking-tight text-fg">
            GoDoor
          </span>
        </div>

        {/* Tagline */}
        <p className="max-w-sm text-center text-[15px] font-medium leading-relaxed text-muted">
          Food, groceries, pharmacy &amp; packages across Uganda — delivered to
          your door. Pay swiftly with GoDoor Wallet.
        </p>

        {/* ── Glass Explore button ─────────────────────────────────────── */}
        <Link
          href="/explore"
          aria-label="Explore GoDoor"
          className="group relative mt-8 inline-flex items-center gap-2.5 overflow-hidden rounded-2xl border border-white/25 bg-white/15 px-8 py-4 text-sm font-semibold text-fg shadow-[0_10px_40px_-12px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition duration-300 hover:-translate-y-0.5 hover:bg-white/25 hover:shadow-[0_18px_50px_-14px_rgba(0,0,0,0.55)] active:translate-y-0 active:scale-[0.98]"
        >
          {/* Sheen sweep on hover */}
          <span
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            aria-hidden="true"
          />
          <Compass className="relative h-[18px] w-[18px] text-go" aria-hidden="true" />
          <span className="relative">Explore GoDoor</span>
          <ArrowRight
            className="relative h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
            aria-hidden="true"
          />
        </Link>

        {/* ── Trust chips ──────────────────────────────────────────────── */}
        <div className="mt-8 flex flex-wrap justify-center gap-2.5 text-[11px] text-muted">
          {[
            { icon: ShieldCheck, label: "Verified merchants" },
            { icon: Wallet, label: "Escrow-protected pay" },
            { icon: Clock, label: "30-min delivery" },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/70 px-3 py-1.5 backdrop-blur-sm"
              >
                <Icon className="h-3.5 w-3.5 text-go" aria-hidden="true" />
                <span className="font-medium">{c.label}</span>
              </span>
            );
          })}
        </div>

        {/* ── Auth entry points ────────────────────────────────────────── */}
        {/* The session is in localStorage, so the server always renders the
            "Sign in / Create account" pair while the client knows from the very
            first render whether someone is signed in. The two trees would
            disagree and React would throw #418 and throw away the whole page.
            Keep rendering what the server rendered until React has hydrated;
            the layout effect flips this before the browser paints. */}
        {showDashboard ? (
          <Link
            href={roleHomePath(role)}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-go px-7 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.98]"
          >
            Go to my dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <div className="mt-7 flex w-full max-w-xs flex-col gap-2.5">
            <Link
              href="/signin"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-go px-6 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.98]"
            >
              Sign in
            </Link>
            <Link
              href="/signin?mode=signup"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface/80 px-6 py-3.5 text-sm font-semibold text-fg backdrop-blur-sm transition hover:bg-elevated active:scale-[0.98]"
            >
              Create account
            </Link>
          </div>
        )}

        {/* ── Slide dots ────────────────────────────────────────────────── */}
        {slides.length > 1 && (
          <div className="mt-7 flex items-center gap-1.5" aria-hidden="true">
            {slides.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i === slideIndex ? "w-5 bg-go" : "w-1.5 bg-go/30"
                }`}
              />
            ))}
          </div>
        )}

        {/* ── Footer line ──────────────────────────────────────────────── */}
        <p className="mt-12 text-center text-[11px] text-dim">
          GoDoor · Live in Masaka · Expanding across Uganda
        </p>
      </div>
    </div>
  );
}
