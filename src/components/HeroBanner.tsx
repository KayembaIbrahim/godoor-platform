"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  EMPTY_BANNER,
  isBannerLive,
  type HeroBanner as HeroBannerData,
  type HeroAudience,
} from "@/lib/hero-banner-core";

/**
 * The sponsored slot at the top of the customer home.
 *
 * WHY THE CLOCK IS CHECKED HERE AS WELL AS ON THE SERVER
 * ------------------------------------------------------
 * The API already refuses to return an expired banner. But a home screen is not
 * a navigation: someone can leave it open across a campaign boundary. If the
 * expiry were only checked at fetch time, a banner whose slot ended at 6pm
 * would keep running on a phone that was left on the home screen all evening —
 * advertising a promotion nobody can honour. `isBannerLive` re-runs on a timer
 * so the slot disappears on its own.
 *
 * WHY IT RENDERS NOTHING RATHER THAN A PLACEHOLDER
 * ------------------------------------------------
 * Reserving the height for a missing ad would push the category row — the thing
 * people actually came for — below the fold on a 360px phone, every visit, to
 * leave a gap for an advertiser who is not running. So when there is nothing
 * live the component returns null and the layout closes up.
 */

const TICK_MS = 30_000;

export function HeroBanner({ audience = "customer" }: { audience?: HeroAudience }) {
  const [banner, setBanner] = useState<HeroBannerData>(EMPTY_BANNER);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    // Public endpoint — no auth header. The banner is an advertisement and is
    // public in the page HTML anyway.
    const url = `/api/hero-banner?audience=${encodeURIComponent(audience)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.banner) setBanner(d.banner);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [audience]);

  // Re-check the window on a timer so a banner that expires while the page is
  // open is withdrawn without the customer doing anything.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const live = isBannerLive(banner, now, audience) ? banner : null;

  // Nothing live → nothing rendered. Reserving the height would push the
  // category row below the fold on every visit to leave a gap for an advertiser
  // who is not running, and guessing at a banner and swapping it would flash
  // the wrong sponsor.
  if (!live) return null;

  const cta = live.ctaUrl ? (
    <Link
      href={live.ctaUrl}
      className="inline-flex items-center gap-1.5 rounded-full bg-go px-4 py-2.5 text-sm font-bold text-white shadow-pop transition hover:bg-go-2 active:scale-95"
    >
      {live.ctaLabel}
      <ArrowRight className="h-4 w-4" />
    </Link>
  ) : null;

  return (
    <section
      aria-label="Featured offer"
      className="hybrid-card group relative isolate overflow-hidden rounded-2xl"
    >
      {/* Image sits behind the copy and is dimmed so white text stays legible
          on ANY sponsor photograph. Without the scrim a light photo makes the
          headline unreadable, and a sponsor's own asset would break their ad. */}
      {live.imageUrl && (
        <>
          <img
            src={live.imageUrl}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/45"
          />
        </>
      )}

      <div className="relative p-4 sm:p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-go">
          Featured
        </p>
        <h2 className="mt-1 max-w-[20ch] font-display text-lg font-bold leading-tight text-on-ink sm:text-xl">
          {live.title}
        </h2>
        {live.subtitle && (
          <p className="mt-1 max-w-[34ch] text-sm leading-snug text-on-ink-muted">
            {live.subtitle}
          </p>
        )}
        {cta && <div className="mt-3">{cta}</div>}
      </div>
    </section>
  );
}

export default HeroBanner;