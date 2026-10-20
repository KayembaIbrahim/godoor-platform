"use client";

import { useEffect, useState } from "react";
import { Sunrise, Sun, Sunset, Moon, Sparkles } from "lucide-react";

import {
  currentGreeting,
  greetingLine,
  greetingSubtext,
  resolveGreetingName,
  type GreetingKey,
} from "@/lib/greeting-core";

/**
 * The personalised greeting card.
 *
 * ── What it is ─────────────────────────────────────────────────────────────
 * A single premium card at the top of every signed-in home screen — customer,
 * rider and business — that greets the user BY NAME and by TIME OF DAY, over
 * artwork the admin can upload (a still image or an animated GIF).
 *
 * ── Why it is self-contained ───────────────────────────────────────────────
 * The three home screens are structurally very different — the customer home
 * is a `.hybrid` screen with its own dark cards, the rider home has a teal
 * theme and a busy earnings header, the business home has an orange theme and
 * a revenue card. Rather than have each of them re-implement the greeting
 * (and each of them drift — different hour tables, different name sources,
 * different treatment of "no name"), the whole card lives here and each
 * screen only decides ONE thing: which name is the best name for that user.
 *
 * The background is fetched by the card itself rather than lifted into each
 * parent, so the admin's published artwork reaches all three screens without
 * three copies of the fetch logic and three chances to forget one of them.
 *
 * ── On the artwork ─────────────────────────────────────────────────────────
 * The image sits behind a scrim and the text sits on top of the scrim. That
 * is deliberate: an admin-chosen photo can be any brightness, and text laid
 * straight onto an arbitrary photo is unreadable about half the time. The
 * scrim is what guarantees the name is always legible, whatever art is
 * published.
 */

type Props = {
  /**
   * The best available name for this user, in priority order. The card tidies
   * it (first word only, no empty strings) and falls back to greeting without
   * a name when there is nothing usable.
   */
  nameCandidates?: Array<string | null | undefined>;
  /** Extra classes for the card wrapper — lets each theme tint it. */
  className?: string;
  /** Render a compact single-line variant (used on narrow rider headers). */
  compact?: boolean;
};

/** The icon that goes with each time of day. */
const GREETING_ICON: Record<GreetingKey, typeof Sunrise> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Sunset,
  night: Moon,
};

export default function GreetingCard({ nameCandidates = [], className = "", compact = false }: Props) {
  const [greeting, setGreeting] = useState<GreetingKey>("morning");
  const [artwork, setArtwork] = useState<{
    url: string;
    isGif: boolean;
    mediaType: "image" | "video";
  } | null>(null);

  // ── Time of day ───────────────────────────────────────────────────────────
  // Read on the client, in the viewer's own timezone: "good evening" has to
  // mean the viewer's evening, not the server's.
  //
  // The first render uses a neutral placeholder rather than guessing, then
  // corrects itself once mounted. Guessing during SSR would bake the BUILD
  // SERVER's hour into the HTML — a user in Uganda opening the app at 9am
  // would be served "Good evening" until a single client-side re-render
  // corrected it, which on a slow phone is long enough to look broken.
  useEffect(() => {
    setGreeting(currentGreeting());
    // Re-check every minute so a screen left open across a boundary (say,
    // opened at 11:59 and left running) updates itself.
    const timer = setInterval(() => setGreeting(currentGreeting()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // ── Admin-published artwork ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/greeting-bg", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const bg = data?.background;
        if (bg?.imageUrl) {
          setArtwork({
            url: bg.imageUrl,
            isGif: Boolean(bg.isGif),
            mediaType: bg.mediaType === "video" ? "video" : "image",
          });
        }
      })
      .catch(() => {
        /* No artwork published, or the network is down — the built-in
           gradient is the fallback and needs no handling here. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The name is resolved on every render rather than memoised. `nameCandidates`
  // is a fresh array on every parent render, so a `useMemo` keyed on it would
  // never actually hit its cache — and the work it guards (splitting a string
  // and picking the first word) is far cheaper than the re-render that would
  // be needed to memoise it properly.
  const name = resolveGreetingName(...nameCandidates);
  const Icon = GREETING_ICON[greeting];

  return (
    <section
      className={`relative isolate overflow-hidden rounded-3xl ${compact ? "p-4" : "p-5"} ${className}`}
      style={{
        // The base gradient lives on the section itself. It is the card's
        // own identity, and it is ALSO the fallback: if the artwork layer
        // below fails to load — a bad URL, a deleted file, a GIF the browser
        // cannot decode — the gradient is what shows through, so the card
        // never renders as an empty box.
        backgroundImage:
          "linear-gradient(135deg, rgb(var(--rgb-primary)) 0%, rgb(var(--rgb-purple)) 100%)",
      }}
    >
      {/* ── Artwork layer ──────────────────────────────────────────────────
          The admin-published image or GIF, painted as a separate layer
          rather than as the section's own background.

          It is separate so the section's gradient can stay put underneath as
          the fallback, and so the layer can carry `background-size: cover`
          without also resizing the gradient. Painting an animated GIF
          directly as the section background forced the browser to repaint
          the TEXT sitting on top of it on every frame; isolating it here
          keeps the copy on its own compositor layer, which is the
          difference between a smooth card and a stuttering one on a
          low-end Android phone. */}
      {artwork ? (
        artwork.mediaType === "video" ? (
          /* A real video file cannot be painted as a background image — it has
             to be a `<video>` element. Muted, looping and inline so it plays
             without a tap on mobile, and it is isolated on its own compositor
             layer so the text on top does not repaint on every frame. */
          <video
            src={artwork.url}
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${artwork.url}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              willChange: "transform",
            }}
          />
        )
      ) : null}

      {/* ── Scrim ─────────────────────────────────────────────────────────
          Guarantees the greeting stays readable over ANY artwork. Without
          it, an admin uploading a bright white photo would silently make the
          name invisible — the kind of bug that only shows up in production,
          on one specific image, and looks like the feature is broken.

          It is NOT `-z-10`: inside this `isolate` stacking context a negative
          z-index child paints BELOW the parent's own background, so the
          scrim would have been completely invisible — and the whole card
          would have been unreadable over light artwork. It sits at z-0 and
          the content is lifted above it. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{
          background: artwork
            ? "linear-gradient(115deg, rgba(12,8,24,0.82) 0%, rgba(12,8,24,0.55) 48%, rgba(12,8,24,0.30) 100%)"
            : "linear-gradient(115deg, rgba(12,8,24,0.34) 0%, rgba(12,8,24,0.14) 100%)",
        }}
      />

      {/* A soft light bloom in the top-right, so the card has depth even on a
          flat gradient. Purely decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 z-0 h-40 w-40 rounded-full opacity-25 blur-2xl"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
      />

      <div className="relative z-10 flex items-start gap-3">
        {/* ── Greeting icon ──────────────────────────────────────────────
            A disc that picks up the time of day: warm for the morning,
            amber at dusk, cool at night. */}
        <span
          className={`grid shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm ${compact ? "h-10 w-10" : "h-12 w-12"}`}
        >
          <Icon className={compact ? "h-5 w-5 text-white" : "h-6 w-6 text-white"} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`font-display font-bold leading-tight text-white ${compact ? "text-base" : "text-xl"}`}
          >
            {greetingLine(greeting, name)}
          </p>
          <p className={`mt-0.5 text-white/75 ${compact ? "text-[11px]" : "text-xs"}`}>
            {greetingSubtext(greeting)}
          </p>
        </div>

        {/* A small "live" spark so the card reads as personalised rather than
            static copy. Decorative only — it carries no meaning for a
            screen reader. */}
        <Sparkles
          aria-hidden
          className={`shrink-0 text-white/45 ${compact ? "h-4 w-4" : "h-5 w-5"}`}
        />
      </div>
    </section>
  );
}
