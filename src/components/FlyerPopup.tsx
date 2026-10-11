"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, ArrowRight } from "lucide-react";
import { useSession } from "@/lib/session-store";
import {
  DISMISS_KEY,
  dismiss,
  pickCampaign,
  pruneDismissals,
  readDismissals,
  type Campaign,
  type Dismissals,
} from "@/lib/campaigns-core";

/**
 * Centred flyer popup for announcements and promotions.
 *
 * Design decisions that are load-bearing, not decoration:
 *
 *  • It is a card, not a takeover. The user asked for something centred that
 *    does not fill the screen, so the card is capped at 26rem and the page stays
 *    visible behind a scrim. A popup that takes the whole screen is the single
 *    most reliable way to get a one-star review.
 *
 *  • The close button appears after 3 seconds, as specified, because a control
 *    that is there instantly gets hit without being read — the delay is what
 *    makes people actually see the flyer. Escape and a tap on the scrim still
 *    work immediately: a timed lock with no other exit is a WCAG failure, and
 *    on a phone there is no keyboard at all, so the scrim tap is the real
 *    escape hatch for most users.
 *
 *  • Dismissal is remembered, per campaign, for the window the admin chose. A
 *    popup that reappears after being closed is worse than no popup, because it
 *    trains people to dismiss without reading — including safety notices.
 *
 *  • Only one campaign shows at a time. Stacking modals is how you build a
 *    popup nobody can escape.
 */

/** How long before the close control appears. */
const REVEAL_MS = 3000;

/** Each tone maps to an existing brand gradient — no invented colours. */
const TONES: Record<Campaign["tone"], string> = {
  brand: "linear-gradient(135deg,#F97316 0%,#FB923C 55%,#EA580C 100%)",
  navy: "linear-gradient(135deg,#0B132B 0%,#131F38 50%,#1E3A8A 100%)",
  purple: "linear-gradient(135deg,#6D28D9 0%,#7C3AED 55%,#4C1D95 100%)",
  success: "linear-gradient(135deg,#047857 0%,#059669 55%,#065F46 100%)",
  gold: "linear-gradient(135deg,#B45309 0%,#D97706 55%,#92400E 100%)",
};

function readStore(): Dismissals {
  if (typeof window === "undefined") return {};
  try {
    return readDismissals(window.localStorage.getItem(DISMISS_KEY));
  } catch {
    // Private mode / storage disabled. Campaign still shows, just unremembered.
    return {};
  }
}

export function FlyerPopup() {
  const role = useSession((s) => s.role);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [canClose, setCanClose] = useState(false);
  const [hidden, setHidden] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  /* ── Load ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        /* Never interrupt the admin portal. It is reached through the secret
           path, so the browser URL is /{secret}/… and cannot be matched here;
           the admin layout marks its own root instead. Checking before the
           fetch also saves a pointless request on every admin page. */
        if (document.querySelector("[data-admin-portal]")) return;

        // Signed out, no role is sent — and the API then returns `all` campaigns
        // only, matching the client's own filter. Sending a guessed role here
        // would let a rider see a new-customer offer the moment they sign out.
        const qs = role ? `?role=${encodeURIComponent(role)}` : "";
        const res = await fetch(`/api/campaigns${qs}`);
        if (!res.ok) return;
        const json: unknown = await res.json();
        const list = (json as { campaigns?: unknown })?.campaigns;
        if (!Array.isArray(list) || cancelled) return;

        const now = Date.now();
        const stored = pruneDismissals(readStore(), now);
        // `pickCampaign` re-checks audience, schedule and dismissal. The server
        // already filtered, but a campaign can also be dismissed locally since
        // it was sent, and re-checking here is what makes that dismissal stick
        // without another round trip.
        const next = pickCampaign(list as Campaign[], role, stored, now);
        if (cancelled) return;
        setCampaign(next);
        // Re-show for a newly-arrived campaign even if it shares an id.
        setHidden(false);
        setCanClose(false);
      } catch {
        /* Network failure — no popup. Never a broken home screen over a promo. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  /* ── The 3-second reveal ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!campaign || hidden) return;
    const t = setTimeout(() => setCanClose(true), REVEAL_MS);
    return () => clearTimeout(t);
  }, [campaign, hidden]);

  const close = useCallback(() => {
    if (!campaign) return;
    setHidden(true);
    try {
      const now = Date.now();
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(dismiss(readStore(), campaign, now)));
    } catch {
      /* Non-fatal: the popup just comes back next visit. */
    }
  }, [campaign]);

  /* ── Keyboard: Escape closes immediately, Tab stays inside the card ────── */
  useEffect(() => {
    if (!campaign || hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const root = cardRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [campaign, hidden, close]);

  if (!campaign || hidden) return null;

  const { title, body, imageUrl, ctaLabel, ctaUrl, tone, id } = campaign;
  const cta = ctaLabel && ctaUrl ? { label: ctaLabel, href: ctaUrl } : null;

  return (
    <div
      // Scrim tap is an immediate dismiss, independent of the 3s reveal.
      onClick={close}
      className="fixed inset-0 z-[99990] flex items-end justify-center bg-black/55 p-4 backdrop-blur-[2px] sm:items-center"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`flyer-title-${id}`}
        onClick={(e) => e.stopPropagation()}
        className="flyer-pop relative w-[min(92vw,26rem)] overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl outline-none"
      >
        {/* Header band carries the brand gradient and the flyer artwork. */}
        <div className="relative h-28 w-full overflow-hidden sm:h-32" style={{ background: TONES[tone] }}>
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 92vw, 416px"
              className="object-cover"
              unoptimized
              priority
            />
          ) : null}
          {/* Keeps the title legible over any flyer image an admin uploads. */}
          {imageUrl ? <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" /> : null}

          {/* The X. Revealed at 3s; invisible but still focusable-guarded so it
              cannot be tabbed into before the delay, which would let the popup
              be dismissed without ever being seen. */}
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            tabIndex={canClose ? 0 : -1}
            aria-hidden={!canClose}
            style={{ opacity: canClose ? 1 : 0, pointerEvents: canClose ? "auto" : "none" }}
            className="absolute right-2.5 top-2.5 grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          <h2 id={`flyer-title-${id}`} className="text-base font-bold leading-snug text-fg">
            {title}
          </h2>
          {body ? (
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted">{body}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            {cta ? (
              <Link
                href={cta.href}
                onClick={close}
                className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
              >
                {cta.label}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
            {canClose ? (
              <button
                type="button"
                onClick={close}
                className="btn btn-ghost btn-sm ml-auto text-muted"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Exported for the admin preview, which renders the exact same gradient set. */
export { TONES as FLYER_TONES, REVEAL_MS as FLYER_REVEAL_MS };
