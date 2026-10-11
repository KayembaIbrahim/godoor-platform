"use client";

import { useMemo } from "react";

/**
 * Scattered light particles for the hero.
 *
 * Pure CSS — no canvas, no requestAnimationFrame, no JS on scroll. The dots
 * are generated once from a fixed seed so the field is stable across renders
 * (and across server/client, which matters because this renders in the first
 * paint) instead of reshuffling on every re-render.
 *
 * `prefers-reduced-motion` disables the drift entirely; the dots stay, because
 * they are decoration, not information.
 */

interface Dot {
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

/** Deterministic PRNG — same field on server and client, no hydration drift. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function ParticleField({ count = 34 }: { count?: number }) {
  const dots = useMemo<Dot[]>(() => {
    const rnd = mulberry32(20260905);
    return Array.from({ length: count }, () => ({
      left: rnd() * 100,
      top: rnd() * 100,
      size: 1 + rnd() * 2.4,
      delay: rnd() * 6,
      duration: 9 + rnd() * 12,
      opacity: 0.18 + rnd() * 0.5,
    }));
  }, [count]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Base wash so the hero has depth without a dark slab.
          Previously an orange + purple wash on a near-black background: the
          white dots were the only thing visible on light, and the purple
          fought the current teal direction. Now the wash is the brand hue
          and the dots invert with the theme. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(13,148,136,0.10),transparent_58%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(249,115,22,0.07),transparent_60%)]" />

      {dots.map((d, i) => (
        <span
          key={i}
          className="particle absolute rounded-full bg-brand/35 dark:bg-white motion-safe:animate-particle-drift"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: `${d.size}px`,
            height: `${d.size}px`,
            opacity: d.opacity,
            animationDelay: `${d.delay}s`,
            animationDuration: `${d.duration}s`,
          }}
        />
      ))}
    </div>
  );
}