"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Compass, ShieldCheck, Wallet, Clock } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuthModal } from "@/lib/auth-modal-store";
import { useSession, roleHomePath } from "@/lib/session-store";

/**
 * GoDoor Welcome Page — app-style entry screen (version 10.5.1).
 *
 * Replaces the long marketing landing page with a true app shell:
 *   1. the GoDoor logo and wordmark, prominent and centred;
 *   2. an admin-customisable background image, loaded live from
 *      /api/welcome-bg so a new background lands WITHOUT a redeploy;
 *   3. a prominent glass-effect Explore button — the single action every
 *      unauthenticated visitor takes first;
 *   4. sign in / create account, which open the shared auth dialog
 *      (the same one the header uses, so the credential handling cannot
 *      drift out of sync).
 *
 * All previous marketing content now lives on /explore, so this screen reads
 * as the app's home rather than a story page.
 */

type Slide = {
  id: string;
  type: "image" | "video";
  url: string;
  durationMs: number;
};

type Background = {
  imageUrl?: string | null;
  intensity?: number;
  slides?: Slide[];
  slideDurationMs?: number;
};

export default function WelcomePage() {
  const { onboarded, role } = useSession();
  const openAuth = useAuthModal((s) => s.open);

  // The published welcome background. A draft preview made in the admin
  // portal is deliberately NOT returned by the public route — only a
  // published background is.
  const [bg, setBg] = useState<Background | null>(null);

  // Which slide of the show is on screen.
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/welcome-bg", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { background?: Background };
        if (alive && data.background) setBg(data.background);
      } catch {
        /* keep the built-in gradient */
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
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-bg">
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
        {onboarded ? (
          <Link
            href={roleHomePath(role)}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-go px-7 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.98]"
          >
            Go to my dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <div className="mt-7 flex w-full max-w-xs flex-col gap-2.5">
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-go px-6 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.98]"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface/80 px-6 py-3.5 text-sm font-semibold text-fg backdrop-blur-sm transition hover:bg-elevated active:scale-[0.98]"
            >
              Create account
            </button>
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
