"use client";

/**
 * First-order promo banner.
 *
 * Sits directly under the search box on the customer home, which is the slot
 * the design calls for: highest-intent element on the screen, immediately
 * below "what am I looking for" and above "what can I do".
 *
 * The claim is real, not decorative. Tapping it copies the promo code that the
 * checkout actually honours and remembers that it was claimed, so a customer
 * who taps once is not asked again on every page load. See
 * src/lib/first-order-offer.ts for why the headline and the discount share
 * one constant.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, ShieldCheck, Ticket } from "lucide-react";
import { FIRST_ORDER_OFFER, firstOrderHeadline } from "@/lib/first-order-offer";

const CLAIMED_KEY = "godoor-first-order-claimed";

/**
 * The live offer shape returned by `/api/promos`.
 *
 * Until that resolves the banner shows the shipped constant, which is also the
 * value the server honours when the store is unreadable — so the banner can
 * never advertise something the checkout would refuse.
 */
type LiveOffer = { code: string; percent: number };

export function PromoBanner() {
  const [claimed, setClaimed] = useState(false);
  const [offer, setOffer] = useState<LiveOffer>({
    code: FIRST_ORDER_OFFER.code,
    percent: FIRST_ORDER_OFFER.percent,
  });

  /* Ask the server which code is featured and what it is worth, so an admin who
     retunes the offer sees it on the banner immediately, without a deploy. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/promos", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { offer?: { code?: unknown; percent?: unknown } };
        const code = typeof json?.offer?.code === "string" ? json.offer.code : "";
        const percent = Number(json?.offer?.percent);
        if (cancelled || !code || !Number.isFinite(percent) || percent <= 0) return;
        setOffer({ code, percent });
      } catch {
        /* Offline — the shipped default is still honoured by the server. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Read the stored claim after mount rather than during render: this is a
  // persisted store, and touching localStorage while rendering is a
  // server/client mismatch.
  useEffect(() => {
    try {
      setClaimed(window.localStorage.getItem(CLAIMED_KEY) === offer.code);
    } catch {
      /* private mode / storage disabled — the banner still works, it just
         cannot remember that it was claimed. */
    }
  }, [offer.code]);

  const claim = useCallback(async () => {
    const code = offer.code;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard is blocked in some in-app browsers. Showing the code is
      // still useful: the customer can type it at checkout.
    }
    try {
      window.localStorage.setItem(CLAIMED_KEY, code);
    } catch {
      /* ignore */
    }
    setClaimed(true);
  }, [offer.code]);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-go via-primary to-go p-4 shadow-lg">
      {/* Soft highlight so the card doesn't read as a flat slab of orange. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-2xl"
      />

      <div className="relative flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold leading-tight text-white drop-shadow-sm">
            {firstOrderHeadline(offer.percent)}
          </p>
          <p className="mt-0.5 text-xs font-medium text-white/85">{FIRST_ORDER_OFFER.note}</p>

          <button
            type="button"
            onClick={claim}
            aria-live="polite"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-go shadow-sm transition hover:bg-white/90 active:scale-95"
          >
            {claimed ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Ticket className="h-3.5 w-3.5" aria-hidden />}
            {claimed ? `${offer.code} copied` : "Claim offer"}
          </button>
          {claimed && (
            <p className="sr-only" role="status">
              Promo code {offer.code} copied to your clipboard. Paste it at checkout.
            </p>
          )}
        </div>

        {/* Shield = escrow protection, the trust signal the offer leans on. */}
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/20 text-white ring-1 ring-white/30">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
      </div>
    </div>
  );
}