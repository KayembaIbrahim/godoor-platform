"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, MapPin, ChevronDown, ArrowRight, UtensilsCrossed, Clock, Sparkles, Loader2, UserPlus } from "lucide-react";
import ParticleField from "./ParticleField";
import { useGeolocation, formatAccuracy } from "@/lib/location";
import { rememberDetectedAddress, getLastAddress } from "@/components/AddressSearchModal";
import { isDeliberate } from "@/lib/customer-location-core";
import { useAuthModal } from "@/lib/auth-modal-store";
import { useSession } from "@/lib/session-store";
import { FIRST_ORDER_OFFER } from "@/lib/first-order-offer";

/**
 * The dark conversion hero.
 *
 * Deep navy rather than the app's light surface — it is the first thing a
 * visitor sees and the one place the brand gets to feel premium. Everything
 * below it stays on the normal light surfaces so purple/orange never becomes
 * the whole product (the brief's "avoid purple fatigue" rule).
 *
 * The search is real: it resolves a place and lands on the browse page for
 * that category. A search box that goes nowhere is worse than no search box.
 */

const SUGGESTIONS = ["Burger", "Pizza", "Local food", "Salad", "Pharmacy", "Groceries", "Packages"];

/** "Food & Restaurants" -> "food-and-restaurants" for the browse route. */
function slugFor(q: string): string {
  const s = q.toLowerCase().trim();
  if (/\b(pharm|medicine|drug|clinic)\b/.test(s)) return "pharmacy";
  if (/\b(grocer|supermarket|market|shopping|food\s*shop)\b/.test(s)) return "groceries";
  if (/\b(packag|parcel|courier|send)\b/.test(s)) return "packages";
  if (/\b(food|restaurant|meal|eat|lunch|dinner|breakfast|kitchen)\b/.test(s)) return "food";
  return "food";
}

export default function DarkHero() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  /* Detection starts on mount, so the FIRST paint must not already be asking
     the visitor to do it by hand. "Choose your location" on load is the manual
     prompt, and it stayed up for the whole of the (silent) detection — which
     is exactly the reported behaviour: "location hasn't been auto filled, I
     have to search manually". Detection in progress now says so. */
  const [where, setWhere] = useState("Detecting your location…");
  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<string | null>(null);
  const geo = useGeolocation();
  /* While the hook is still working, the control must look alive whether the
     detection was automatic or started by a tap. Previously only a tap set
     `locating`, so the automatic pass showed a static pin over a manual
     prompt — visually claiming nothing was happening. */
  const isDetecting = locating || geo.status === "idle" || geo.status === "locating";
  const { onboarded } = useSession();
  const openAuth = useAuthModal((s) => s.open);

  /**
   * The discount this banner advertises.
   *
   * These three lines used to be hardcoded "Get 40% off your first order" /
   * "Claim 40% off". The offer was retuned to 20% (`FIRST20`, admin-editable
   * from the portal) and the banner kept advertising 40 — so the storefront
   * was promising a discount twice the one the checkout honours. On a live
   * payments page that is a false pricing claim, not a cosmetic mismatch.
   *
   * The figure is now read from `/api/promos`, which reports whichever code an
   * admin has marked featured, and falls back to the shipped constant when the
   * store is unreadable — so a database hiccup shows an ordinary discount
   * rather than an impossible one. One value, two places it appears: the
   * headline and the button.
   */
  const [offer, setOffer] = useState<{ percent: number; code: string; note: string }>(FIRST_ORDER_OFFER);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/promos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.offer) return;
        const pct = Number(j.offer?.percent);
        if (!Number.isFinite(pct) || pct <= 0) return;
        const code = typeof j.offer?.code === "string" && j.offer.code ? j.offer.code : null;
        setOffer((prev) => ({ ...prev, percent: pct, ...(code ? { code } : {}) }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Surface whatever geolocation already resolved, without re-requesting it.
  useEffect(() => {
    if (!geo.coords) return;
    /* An address the customer deliberately chose wins here too. The hero used
       to show the live reading unconditionally, so someone who had picked their
       own address on a previous visit saw it replaced by whatever the device
       resolved to — and then signed in to a home screen showing the pick, and
       back out to a welcome page showing something else. Both surfaces now
       resolve through the same rule. */
    const saved = getLastAddress();
    if (isDeliberate(saved)) {
      setWhere(saved!.place);
      setAccuracy(null);
      setLocating(false);
      return;
    }
    setWhere(geo.address ? geo.address : "Current location");
    setAccuracy(geo.accuracy != null ? formatAccuracy(geo.accuracy) : null);
    setLocating(false);
    // Carry the detected area into the signed-in app. Without this the hero
    // showed "Kampala" and then threw it away, so signing in dropped the
    // customer back onto the manual "Set your delivery address" prompt.
    if (geo.address) rememberDetectedAddress(geo.address, geo.coords);
  }, [geo.coords, geo.address, geo.accuracy]);

  /* Detection finished with nothing to show — permission denied, or no GPS and
     no reachable IP provider. NOW, and only now, ask by hand: it is a genuine
     dead end rather than a pause the visitor is meant to wait out. */
  useEffect(() => {
    if (geo.status !== "denied" || geo.coords) return;
    setWhere("Choose your location");
    setAccuracy(null);
    setLocating(false);
  }, [geo.status, geo.coords]);

  const go = (raw?: string) => {
    const q = (raw ?? query).trim();
    router.push(`/browse/${slugFor(q)}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  };

  const useGps = () => {
    setLocating(true);
    setAccuracy(null);
    if (geo.coords) {
      setWhere(geo.address ? geo.address : "Current location");
      setAccuracy(geo.accuracy != null ? formatAccuracy(geo.accuracy) : null);
      setLocating(false);
      return;
    }
    geo.refresh();
  };

  return (
    <section className="relative isolate overflow-hidden bg-bg pb-14 pt-16 md:pb-20 md:pt-24">
      <ParticleField />

      <div className="relative z-10 mx-auto max-w-5xl px-4 text-center">
        {/* Eyebrow */}
        <p className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/10 px-3.5 py-1.5 text-xs font-semibold text-brand">
          <Sparkles className="h-3.5 w-3.5 text-brand" />
          Food, groceries, pharmacy &amp; packages — one app
        </p>

        <h1 className="mx-auto mt-6 max-w-3xl font-display text-[2.1rem] font-bold leading-[1.12] tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]">
          Discover and order{" "}
          <span className="text-go">restaurant meals</span> effortlessly
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          Real kitchens near you, tracked live to your door. Pay with the GoDoor Wallet
          and every shilling stays in escrow until you say it arrived.
        </p>

        {/* ── Account entry, before the search box ─────────────────────────
            A visitor arriving on the welcome page had no account and no visible
            reason to make one until they had already scrolled past the hero,
            the categories and the merchant list. The account is what the wallet,
            the escrow, the live tracking and the reorder history all hang off,
            so it is offered here, immediately under the value proposition,
            rather than as a small "Sign in" link buried in the header.

            This is NOT a login wall, and deliberately so. Walling `/` behind
            authentication would hide the whole marketing page from anyone
            arriving from a search engine, a shared link, or a merchant's own
            referral — and it would put the paid sponsored banner behind a form
            nobody has a reason to fill in yet. So the page still browses
            without an account; this simply makes joining the obvious next step
            for the people who came here to order.

            Both buttons drive the one auth dialog and ask for the form that
            matches the button, rather than opening sign-in and making the
            visitor find the toggle. Signed-in visitors get neither — the
            account menu in the header is already their route in. */}
        {!onboarded && (
          <div className="mt-7 flex flex-col items-center gap-2.5 sm:flex-row sm:justify-center sm:gap-3">
            <button
              type="button"
              onClick={() => openAuth("signup")}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-bold text-white shadow-[0_10px_30px_-12px_rgba(249,115,22,0.9)] transition hover:bg-go-2 active:scale-[0.98] sm:w-auto"
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Create free account
            </button>
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-fg transition hover:bg-elevated active:scale-[0.98] sm:w-auto"
            >
              Sign in
            </button>
          </div>
        )}
        {!onboarded && (
          <p className="mt-2.5 text-[11px] text-muted">
            Free to join · No card needed to order
          </p>
        )}

        {/* Search */}
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-2 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)] sm:flex-row sm:items-center">
            {/* Location selector */}
            <button
              type="button"
              onClick={useGps}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-left transition hover:bg-elevated sm:max-w-[15rem]"
            >
              {isDetecting ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
              ) : (
                <MapPin className="h-4 w-4 shrink-0 text-brand" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-fg">
                  {where}
                </span>
                <span className="block truncate text-[10px] text-muted">
                  {accuracy
                    ? `Accurate to ${accuracy}`
                    : isDetecting
                      ? "Using your device location"
                      : "Tap to set a location"}
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
            </button>

            <span aria-hidden="true" className="hidden w-px self-stretch bg-border sm:block" />

            {/* Query */}
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") go();
                }}
                placeholder="Search food, groceries, pharmacy..."
                aria-label="Search food, groceries, pharmacy"
                className="min-h-11 w-full bg-transparent text-sm text-fg placeholder:text-muted outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => go()}
              className="min-h-11 shrink-0 rounded-xl bg-go px-6 text-sm font-bold text-white shadow-[0_10px_30px_-10px_rgba(249,115,22,0.9)] transition hover:bg-go-2 active:scale-[0.98]"
            >
              Order Now
            </button>
          </div>

          {/* Suggestions */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuery(s);
                  go(s);
                }}
                className="min-h-11 rounded-full border border-border bg-surface px-3.5 text-xs font-medium text-muted transition hover:border-brand/50 hover:bg-brand/10 hover:text-fg"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Promo banner */}
        <div className="relative mx-auto mt-10 max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-go via-[#EA580C] to-go-2 p-6 text-left shadow-[0_24px_60px_-24px_rgba(249,115,22,0.85)] sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15 blur-2xl"
          />
          <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                <UtensilsCrossed className="h-3 w-3" />
                First order
              </p>
              <p className="mt-3 font-display text-3xl font-bold leading-tight text-white sm:text-4xl">
                Get {offer.percent}% off your first order
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-white/85">
                <Clock className="h-3.5 w-3.5" />
                Use code {offer.code} at checkout · Escrow protected
              </p>
            </div>

            <Link
              href="/browse/food"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-[#EA580C] shadow-lg transition hover:scale-[1.02] active:scale-[0.98]"
            >
              Claim {offer.percent}% off
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Trust line.
            This was `text-white/45` on a `bg-bg` section. Now that the page is
            a true white, that is white-on-white — the three things customers
            most need to believe (escrow, tracking, verification) were the only
            line on the hero guaranteed to be unreadable. `text-muted` is
            theme-aware, so it is legible on white and on black. */}
        <p className="mt-7 text-xs text-muted">
          GoDoor Wallet escrow · Live GPS tracking · Verified kitchens &amp; riders
        </p>
      </div>
    </section>
  );
}