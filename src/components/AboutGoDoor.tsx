"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Smartphone, Wallet, Truck, MapPin, ShieldCheck, CheckCircle2, Clock,
  HeartHandshake, ChevronLeft, ChevronRight,
} from "lucide-react";

/**
 * Single deep-navy sliding info bar.
 * All 8 slides live inside ONE rectangular navy container — content scrolls
 * horizontally inside it. No separate square tiles, no visible borders.
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

export function AboutGoDoor() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = SLIDES.length;

  const goTo = useCallback((index: number) => {
    setCurrent(((index % total) + total) % total);
    const el = scroller.current;
    if (el) {
      const child = el.children[((index % total) + total) % total] as HTMLElement | undefined;
      if (child) el.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
    }
  }, [total]);

  const next = useCallback(() => goTo(current + 1), [goTo, current]);
  const prev = useCallback(() => goTo(current - 1), [goTo, current]);

  useEffect(() => {
    if (paused) return;
    timer.current = setInterval(() => {
      setCurrent((c) => {
        const target = (c + 1) % total;
        const el = scroller.current;
        if (el) {
          const child = el.children[target] as HTMLElement | undefined;
          if (child) el.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
        }
        return target;
      });
    }, 3500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, total]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];
    let closest = 0;
    let best = Infinity;
    children.forEach((child, i) => {
      const dist = Math.abs(child.offsetLeft - el.scrollLeft);
      if (dist < best) { best = dist; closest = i; }
    });
    setCurrent(closest);
  };

  // Move scroller to current index when goingTo is called via button
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const child = el.children[current] as HTMLElement | undefined;
    if (child) el.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
  }, [current]);

  return (
    <div
      className="relative select-none overflow-hidden rounded-3xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Deep navy single tile — all slides slide inside this one container */}
      <div className="relative bg-[#0b0712] px-4 py-6 md:py-8">
        {/* Subtle gradient accent at top */}
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-go/80 via-primary/60 to-go/80" />

        {/* Section label */}
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-go" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-go/80">
            GoDoor
          </span>
        </div>

        {/* Sliding content container */}
        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex gap-6 overflow-x-auto snap-x snap-mandatory"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {SLIDES.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.title}
                className="w-72 shrink-0 snap-start"
              >
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-go/50">
                    {s.kicker}
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/20 text-go transition-colors group-hover:bg-go/30">
                      <Icon size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold leading-snug text-white">{s.title}</h3>
                      <p className="mt-0.5 text-xs leading-snug text-white/50">{s.desc}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Left arrow */}
        <button
          onClick={prev}
          aria-label="Previous"
          className="absolute left-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20 active:scale-90"
        >
          <ChevronLeft size={18} />
        </button>
        {/* Right arrow */}
        <button
          onClick={next}
          aria-label="Next"
          className="absolute right-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20 active:scale-90"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Dots */}
      <div className="mt-3 flex justify-center gap-1.5 px-4">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? "w-5 bg-go" : "w-1.5 bg-border hover:bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
