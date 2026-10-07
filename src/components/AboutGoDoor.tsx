"use client";

import { useEffect, useState } from "react";
import {
  Smartphone, Wallet, Truck, MapPin, ShieldCheck, CheckCircle2, Clock,
  HeartHandshake,
} from "lucide-react";

/**
 * Deep-navy "how it works / why GoDoor" banner.
 *
 * One slide is on screen at a time and it cross-fades in place, so the panel
 * always fits its container. The previous version scrolled a strip of
 * fixed-width slides sideways, which overflowed narrow phones and left the
 * next slide half-peeking.
 *
 * The band is deliberately full-bleed: it is rendered outside the page's
 * horizontal padding, so it reaches both screen edges instead of floating as
 * an inset card. Title and description share a single paragraph so the band
 * stays two lines tall on every slide.
 *
 * There are deliberately no side arrows: the progress ticks under the copy are
 * the navigation, and hovering pauses the rotation.
 *
 * The panel is `.navy-banner`, whose colours are literals rather than theme
 * tokens, so the copy keeps its contrast on the light canvas. The ticks live
 * *inside* the panel and use `.navy-tick-*`; when they sat outside it on a
 * themed `bg-border` (#E2E8F0) they were effectively invisible in light mode.
 */

type Slide = {
  icon: typeof Smartphone;
  kicker: string;
  title: string;
  desc: string;
};

const SLIDES: Slide[] = [
  { kicker: "HOW IT WORKS", icon: Smartphone, title: "Browse & order", desc: "Find local shops near you and add to cart in seconds." },
  { kicker: "HOW IT WORKS", icon: Wallet, title: "Pay your way", desc: "GoDoor Wallet — fund via Morse, pay securely with escrow protection. No bank card needed." },
  { kicker: "HOW IT WORKS", icon: Truck, title: "Track & receive", desc: "Watch your rider live on the map until it reaches your door." },
  { kicker: "WHY GODOOR", icon: MapPin, title: "Live GPS tracking", desc: "See exactly where your rider is, in real time." },
  { kicker: "WHY GODOOR", icon: ShieldCheck, title: "Verified & trusted", desc: "Every business and rider is verified for your safety." },
  { kicker: "WHY GODOOR", icon: CheckCircle2, title: "Real order updates", desc: "Get notified at every step of your order." },
  { kicker: "WHY GODOOR", icon: Clock, title: "Fast delivery", desc: "Most orders arrive within 30 minutes." },
  { kicker: "WHY GODOOR", icon: HeartHandshake, title: "Supporting locals", desc: "Your order keeps real Ugandan businesses growing." },
];

const ROTATE_MS = 3500;

export function AboutGoDoor() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = SLIDES.length;

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(
      () => setCurrent((c) => (c + 1) % total),
      ROTATE_MS,
    );
    return () => clearInterval(timer);
  }, [paused, total]);

  const slide = SLIDES[current];
  const Icon = slide.icon;

  return (
    <div
      className="navy-banner w-full px-4 py-3 sm:px-5 sm:py-3.5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="How GoDoor works"
    >
      <div
        key={current}
        className="flex items-start gap-2.5 sm:gap-3"
        style={{ animation: "navy-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both" }}
      >
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/20 text-go sm:h-9 sm:w-9">
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-go/80">
            <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-go" />
            {slide.kicker}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-white/75 sm:text-[13px]">
            <span className="font-bold text-white">{slide.title}</span>
            <span className="mx-1 text-white/30">—</span>
            <span className="line-clamp-2">{slide.desc}</span>
          </p>
        </div>
      </div>

      {/* Progress ticks — the only navigation, inside the panel so they keep
          their contrast on the light canvas. */}
      <div className="mt-2 flex items-center gap-1">
        {SLIDES.map((s, i) => (
          // The tick stays a 4px hairline, but a 4px-tall control is untappable
          // on a phone. The button carries the 44px hit area and the bar is a
          // child, so the visual weight is unchanged. (A ::after overlay was
          // tried first — Tailwind emits `content: var(--tw-content)` but never
          // defines the variable, so no pseudo-element rendered.)
          <button
            key={s.title}
            type="button"
            onClick={() => setCurrent(i)}
            aria-label={s.title}
            aria-current={i === current}
            className="flex min-h-11 flex-1 items-center"
          >
            <span
              className={`block h-1 w-full rounded-full transition-colors duration-300 ${
                i === current ? "navy-tick-on" : "navy-tick-off"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
