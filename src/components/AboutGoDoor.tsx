"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Smartphone, Wallet, Truck, MapPin, ShieldCheck, CheckCircle2, Clock,
  HeartHandshake, ChevronLeft, ChevronRight,
} from "lucide-react";

/**
 * Compact rectangular card carousel that replaces the promo banner on the
 * customer home. There are no live promotions right now, so the slides tell
 * the story: how GoDoor works and why it's trusted.
 */

type Slide = {
  icon: typeof Smartphone;
  tint: string;
  kicker: string;
  title: string;
  desc: string;
};

const colorMap: Record<string, string> = {
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  teal: "bg-teal-500",
};

const SLIDES: Slide[] = [
  { kicker: "How GoDoor works", icon: Smartphone, tint: "sky", title: "Browse & order", desc: "Find local shops near you and add to cart in seconds." },
  { kicker: "How GoDoor works", icon: Wallet, tint: "emerald", title: "Pay your way", desc: "Morse wallet first, or MTN MoMo, Airtel Money, cash — no bank card needed." },
  { kicker: "How GoDoor works", icon: Truck, tint: "amber", title: "Track & receive", desc: "Watch your rider live on the map until it reaches your door." },
  { kicker: "Why GoDoor", icon: MapPin, tint: "blue", title: "Live GPS tracking", desc: "See exactly where your rider is, in real time." },
  { kicker: "Why GoDoor", icon: ShieldCheck, tint: "orange", title: "Verified merchants & riders", desc: "Every business and rider is verified for your safety." },
  { kicker: "Why GoDoor", icon: CheckCircle2, tint: "pink", title: "Real order updates", desc: "Get notified at every step of your order." },
  { kicker: "Why GoDoor", icon: Clock, tint: "orange", title: "Fast delivery", desc: "Most orders arrive within 30 minutes." },
  { kicker: "Why GoDoor", icon: HeartHandshake, tint: "teal", title: "Supporting local shops", desc: "Your order keeps real Ugandan businesses growing." },
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
    }, 3000);
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
      if (dist < best) {
        best = dist;
        closest = i;
      }
    });
    setCurrent(closest);
  };

  return (
    <div
      className="relative select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pb-3"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {SLIDES.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="w-56 shrink-0 snap-start rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md"
            >
              <div className={`h-1 w-full rounded-t-2xl ${colorMap[s.tint]}`} />
              <div className="p-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-go">
                  {s.kicker}
                </span>
                <div className={`mt-2 grid h-9 w-9 place-items-center rounded-xl text-white ${colorMap[s.tint]}`}>
                  <Icon size={18} />
                </div>
                <h3 className="mt-2.5 text-sm font-bold leading-snug text-gray-900">{s.title}</h3>
                <p className="mt-1 text-xs leading-snug text-gray-500">{s.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={prev}
        aria-label="Previous"
        className="absolute left-1 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-95"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={next}
        aria-label="Next"
        className="absolute right-1 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-95"
      >
        <ChevronRight size={16} />
      </button>

      <div className="mt-1 flex justify-center gap-1.5 px-4">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            onClick={() => goTo(i)}
            aria-label={`Slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? "w-5 bg-go" : "w-1.5 bg-gray-300 hover:bg-gray-400"
            }`}
          />
        ))}
      </div>
    </div>
  );
}