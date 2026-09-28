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
  { kicker: "HOW IT WORKS", icon: Wallet, title: "Pay your way", desc: "Morse wallet first, or MTN MoMo, Airtel Money, cash — no bank card needed." },
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
      className="navy-banner rounded-2xl px-4 py-5 sm:rounded-3xl sm:px-6 sm:py-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="How GoDoor works"
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-go" />
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-go/80">
          GoDoor
        </span>
      </div>

      {/* The reserved height is sized for the longest copy at the narrowest
          supported width, so the panel never resizes mid-rotation. */}
      <div className="min-h-[6.75rem] sm:min-h-[5.5rem]">
        <div
          key={current}
          className="flex items-start gap-3 sm:gap-4"
          style={{ animation: "navy-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both" }}
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/20 text-go">
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-go/70">
              {slide.kicker}
            </p>
            <h3 className="mt-0.5 text-sm font-bold leading-snug text-white sm:text-[15px]">
              {slide.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-white/70 sm:text-[13px]">
              {slide.desc}
            </p>
          </div>
        </div>
      </div>

      {/* Progress ticks — the only navigation, inside the panel so they keep
          their contrast on the light canvas. */}
      <div className="mt-4 flex items-center gap-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => setCurrent(i)}
            aria-label={s.title}
            aria-current={i === current}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i === current ? "navy-tick-on" : "navy-tick-off"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
