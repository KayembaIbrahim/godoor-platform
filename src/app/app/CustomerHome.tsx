"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  MapPin, Star, ChevronDown, Search, BadgeCheck, Clock, ShieldCheck,
  Navigation, Store, Wallet as WalletIcon, Gift, X,
} from "lucide-react";

import { ProductSearch } from "@/components/ProductSearch";
import ActiveDeliveryCard from "@/components/ActiveDeliveryCard";
import { QuickReorder } from "@/components/QuickReorder";
import { QuickServicesGrid } from "@/components/QuickServicesGrid";
import { Logo } from "@/components/Logo";
import { HeaderAuth } from "@/components/HeaderAuth";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeroBanner } from "@/components/HeroBanner";
import { StoriesStrip, StoryViewer, type Story } from "@/components/StoriesViewer";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { AddressSearchModal, getLastAddress, rememberDetectedAddress } from "@/components/AddressSearchModal";
import { CustomerNav } from "@/components/CustomerNav";
import GreetingCard from "@/components/GreetingCard";
import Favourites from "@/components/home/Favourites";
import DeliveryPreference from "@/components/home/DeliveryPreference";
import TableBooking from "@/components/home/TableBooking";

import { useSession } from "@/lib/session-store";
import { useMerchants } from "@/lib/hooks";
import { useFavorites } from "@/lib/customer-stores";
import { useActiveOrder } from "@/lib/use-active-order";
import {
  useGeolocation,
  distanceKm,
  formatDistance,
  detectDistrict,
  MASAKA as MASAKA_FALLBACK,
} from "@/lib/location";
import {
  resolveEffectiveLoc,
  resolveDisplayAddress,
  isDetecting,
  type StoredCustomerAddress,
} from "@/lib/customer-location-core";
import { CATEGORIES } from "@/lib/categories";

/**
 * GoDoor customer home — hybrid theme.
 *
 * ── What this screen is for ────────────────────────────────────────────────
 * Discovery only: where you are, what you can order, what is popular right
 * now, and how to get last night's order again. It is deliberately NOT the
 * complete catalogue.
 *
 * ── Why the long shop list was removed ─────────────────────────────────────
 * The previous home ended in an unbounded grid of every merchant with a filter
 * sheet on top. With only a couple of businesses onboarded that grid was two
 * cards and six dead controls; with a hundred it would push "Reorder" and the
 * trust strip several screens down. Either way it competed with the four things
 * a customer actually came for. The full list, with sorting and filtering, now
 * lives at `/categories` → any category, which is the destination the category
 * row was already pointing at — those links used to scroll a page that still
 * had the whole catalogue sitting under them, so nothing was gained by either.
 *
 * ── Why the hybrid theme is scoped to `.hybrid` ────────────────────────────
 * It re-points the design tokens for this screen only (see globals.css). The
 * admin portal, merchant console and rider app keep their own light/dark. Drop
 * the class and the screen reverts exactly.
 */

export default function CustomerHome() {
  const { role, onboarded, profile } = useSession();

  // Role guard: business/rider should never see the customer marketplace.
  useEffect(() => {
    if (!onboarded) return;
    if (role === "business") window.location.href = "/business";
    else if (role === "rider") window.location.href = "/rider";
    else if (role === "admin") window.location.href = "/admin";
  }, [role, onboarded]);

  const [q, setQ] = useState("");
  const [stories, setStories] = useState<Story[]>([]);
  const [storyViewerIdx, setStoryViewerIdx] = useState<number | null>(null);
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [deliveryAddr, setDeliveryAddr] = useState<StoredCustomerAddress | null>(null);
  const [detectedDistrict, setDetectedDistrict] = useState<string | null>(null);

  const signup = useSignupPrompt();
  const { coords: gpsLoc, address: gpsPlace, status: locStatus } = useGeolocation();
  const activeOrder = useActiveOrder();
  const { merchantIds: favIds, toggle: toggleFav } = useFavorites();
  const { merchants, loading: merchantsLoading } = useMerchants();

  useEffect(() => {
    const saved = getLastAddress();
    if (saved) setDeliveryAddr(saved);
  }, []);

  useEffect(() => {
    fetch("/api/stories").then((r) => r.json()).then(({ stories: s }) => setStories(s || [])).catch(() => {});
  }, []);

  /**
   * Is `effectiveLoc` a position we actually measured, or the launch-city
   * fallback?
   *
   * The distinction matters because the fallback was being treated as a real
   * reading. `locStatus` is `"idle"` on the FIRST render — before detection has
   * even been requested — and `"idle"` was listed alongside `"denied"` as a
   * reason to substitute a fallback. So on every single page load the screen
   * snapped to a hard-coded city coordinate within a frame or two, `detectDistrict`
   * reverse-geocoded *that* coordinate, and the header then displayed
   * "Near <that city>" — a place the customer was never in. It is the reason
   * `/app` looked like it was not detecting anything while the welcome page,
   * which has no such branch, showed the real address.
   *
   * Only `"denied"` — a definite answer — now substitutes a fallback. `"idle"`
   * and `"locating"` mean detection is still in flight, and in flight is exactly
   * when the UI must wait for the truth rather than invent a place.
   */
  const { loc: effectiveLoc, isFallback: locIsFallback } = useMemo(
    () => resolveEffectiveLoc({ saved: deliveryAddr, gpsLoc, status: locStatus }, MASAKA_FALLBACK),
    [deliveryAddr, gpsLoc, locStatus],
  );

  useEffect(() => {
    // Never reverse-geocode the fallback — that is how a guessed coordinate
    // turned into a confidently wrong district name in the header. Clearing it
    // matters as much as skipping it: the effect used to only ever assign, so a
    // wrong district that landed once stayed for the rest of the session.
    if (!effectiveLoc || locIsFallback) {
      setDetectedDistrict(null);
      return;
    }
    let cancelled = false;
    detectDistrict(effectiveLoc).then((d) => {
      if (!cancelled) setDetectedDistrict(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [effectiveLoc?.lat, effectiveLoc?.lng, locIsFallback]);

  /**
   * Where the app thinks you are.
   *
   * Reporting this is the whole point of the control. "Detecting your location…"
   * is its own state, and that distinction is what makes the home screen behave
   * like the welcome page: detection already runs automatically on mount, but
   * while it was in flight the bold line read "Set your delivery address" — the
   * manual-search prompt — so the screen looked like nothing was happening and
   * tapping through to the search modal was the only visible way forward.
   */
  const isLocating = isDetecting(locStatus);
  const displayAddress = resolveDisplayAddress({
    saved: deliveryAddr,
    gpsPlace,
    gpsLoc,
    detectedDistrict,
    status: locStatus,
  });

  /**
   * Keep the detected location, so it survives leaving the page.
   *
   * The welcome page did this; `/app` did not. So a customer who opened the
   * app directly from a link or a notification got their location detected,
   * used it to sort the catalogue, and then had it thrown away — the next load
   * started from nothing again. It only ever fills a gap, so an address the
   * customer picked by hand is never overwritten.
   */
  useEffect(() => {
    rememberDetectedAddress(gpsPlace, gpsLoc);
  }, [gpsPlace, gpsLoc?.lat, gpsLoc?.lng]);

  /**
   * Popular Picks — a short, curated list.
   *
   * Ranked rather than sliced: raw order is whatever the database returned, so
   * "popular" was really "first four". Ranking blends rating with proximity so
   * a 4.9 three districts away does not displace a 4.7 next door, and pushes
   * businesses with no rating at all to the bottom rather than letting an
   * unrated row sort above a proven one.
   */
  const picks = useMemo(() => {
    const scored = merchants
      .filter((m) => m.status !== "suspended")
      .map((m) => {
        const rating = m.rating || 0;
        const dist = effectiveLoc ? distanceKm(effectiveLoc, m) : null;
        // Rating is the dominant term; distance only breaks ties between
        // comparably-rated businesses, which is what "popular near you" means.
        const proximity = dist === null ? 1 : Math.max(0, 1 - dist / 25);
        return { m, score: rating * 2 + proximity + (m.verified ? 0.25 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map((s) => s.m);
  }, [merchants, effectiveLoc]);


  /**
   * In-page search over the merchant list.
   *
   * Kept deliberately narrow: the full directory lives at `/categories` with
   * sorting and filtering, so this is a shortcut for "I know roughly what I
   * want" — not a second catalogue that would have to be kept in sync.
   *
   * The needle is lower-cased ONCE outside the loop. Doing it per merchant
   * re-allocated a string for every row on every keystroke, which is visible on
   * a low-end Android.
   */
  const searchHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return 0;
    return merchants.filter((m) => {
      const area = (m.area || "").toLowerCase();
      const district = (m.district || "").toLowerCase();
      const category = (m.category || "").toLowerCase();
      return (
        m.name.toLowerCase().includes(needle) ||
        m.tagline.toLowerCase().includes(needle) ||
        area.includes(needle) ||
        district.includes(needle) ||
        category.includes(needle)
      );
    }).length;
  }, [merchants, q]);

  /* Stamp the pick as deliberate. The modal has already written it to storage
     with the same marker, but the in-memory copy is what the header and the
     catalogue read this render — and an unstamped copy is indistinguishable
     from a stale machine-detected one, which would silently lose the choice the
     customer just made. */
  const handleAddressSelect = useCallback((result: { place: string; lat: number; lng: number }) => {
    setDeliveryAddr({ ...result, source: "manual" });
  }, []);

  return (
    <div className="hybrid mx-auto min-h-[70vh] max-w-lg pb-28 md:max-w-3xl lg:max-w-5xl">
      {/* The page had no <h1> at all — headings jumped straight to business
          names, so assistive tech and crawlers had no page title. */}
      <h1 className="sr-only">GoDoor — order food, groceries, rides and medicines in Uganda</h1>

      {/* ── A. Header ────────────────────────────────────────────────────
          ONE row: logo, location pill, then icons. The global HeaderClient
          steps aside on this route (see SELF_HEADED_ROUTES) because rendering
          both produced two headers and a duplicated logo.

          Sticky, because the location and the search are the two controls a
          customer reaches for mid-scroll. Everything below is ordinary flow.

          `safe-area-top` is load-bearing, not decoration. With
          `viewport-fit=cover` it reserves the status-bar / dynamic-island band,
          so on a notched phone running fullscreen the row is not drawn
          underneath it. Without it the header — and with it the location
          control — sits behind the notch. */}
      <header className="safe-area-top sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-3 py-2">
          <Link
            href="/"
            className="flex min-h-11 min-w-0 shrink items-center transition-transform active:scale-95"
            aria-label="GoDoor home"
          >
            {/* `surface` is left on `auto`, so the artwork follows the customer's
                own light/dark choice.

                This used to pin `surface="light"`, on the grounds that the page
                was cream in BOTH themes. That stopped being true: `.hybrid` now
                paints `rgb(var(--rgb-canvas))` and follows the theme like every
                other surface. The pin therefore did the opposite of what it was
                added for — on a dark phone it forced the NAVY artwork onto a
                near-black header, which is precisely "the logo doesn't adapt to
                dark mode, it stays deep navy".

                The earlier version of this bug (white artwork on cream, i.e.
                invisible) was caused by `.hybrid` hard-setting a light canvas.
                Fixing the token remap fixed that at its source, so the pin is
                now only able to cause harm. */}
            {/* Capped at 76px: the 4:1 lockup is 96px at the "sm" height,
                which ate a third of a 360px header row and pushed the four
                account controls up against the edge. With a cap the artwork
                scales down proportionally instead of the controls shrinking. */}
            <Logo size="sm" maxWidth={76} />
          </Link>

          {/* The location selector used to sit HERE — in the middle of the
              header row, between the logo and the search button. On a 360px
              phone that left the logo, a truncated address and three icon
              buttons sharing one row, and the address was the thing that got
              squeezed. It now has its own full-width row BELOW the header
              (see the "Deliver to" row further down), so the header carries
              only the brand, the page context and the account controls, and
              the address always has the whole width to itself. */}

          {/* The icon cluster — the three UTILITY controls (search,
              notifications, theme) share ONE capsule, and the account
              control stands on its own beside it.

              Same rule as the global header: utilities belong in a bar
              because they are chrome, not destinations. The account control
              is an ACTION, so it is pulled out and given its own surface —
              and it sits LAST, in the RIGHT corner, so it is never mistaken
              for part of the GoDoor logo on the left. It used to be first,
              which butted it straight against the brand. */}
          <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
            <div className="icon-bar">
              <button
                type="button"
                onClick={() => setProductSearchOpen(true)}
                aria-label="Search GoDoor"
                className="icon-bar-item tap-44"
              >
                <Search className="h-4 w-4" />
              </button>
              <NotificationBell inBar />
              <ThemeToggle inBar />
            </div>
            <HeaderAuth compact />
          </div>
        </div>
      </header>

      {/* ── Location row ──────────────────────────────────────────────────
          Its OWN full-width row, directly BELOW the header. Version 10.5.1
          moved it out of the header row because three things shared one line:
          the logo, a truncated address and three icon buttons. The address
          lost the contest every time, which is the one piece of information a
          customer checks before ordering.

          This row carries the location icon, the current address and the
          change-location action, and it has the whole width to itself, so a
          long address truncates only when it genuinely runs out of room.

          It opts into the DARK card explicitly and names its text colour with
          it. It used to paint `bg-surface` and inherit `text-fg`; when
          `surface` was remapped to ink that pairing collapsed to 1.12:1 — the
          address was invisible. Stating the surface and the text together
          makes that pairing impossible to get wrong. */}
      <div className="sticky top-[3.25rem] z-20 border-b border-hairline bg-canvas/90 px-4 py-2 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setAddressSearchOpen(true)}
          aria-label={`Delivery location: ${displayAddress}. Tap to change.`}
          className="tap-44 hybrid-card group flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2 text-left transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-go/40 active:scale-[0.995]"
        >
          {/* The pin breathes while detection is in flight. Without a moving
              part the control looked inert for the second or two the fix
              takes, which is what made a customer tap through to the search
              modal instead of waiting. */}
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-go/12">
            <MapPin
              className={`h-4 w-4 text-go ${isLocating ? "animate-pulse" : ""}`}
            />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium uppercase leading-none tracking-wide text-on-ink-muted">
              {isLocating ? "Locating you" : "Deliver to"}
            </span>
            <span className="mt-0.5 block truncate text-[13px] font-semibold leading-tight text-on-ink">
              {displayAddress}
            </span>
          </span>

          {/* The change-location action, named rather than implied by a
              chevron alone — the chevron used to be the only cue and it read
              as "expand", not "change". */}
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-go/12 px-2.5 py-1 text-[11px] font-semibold text-go">
            Change
            <ChevronDown className="h-3 w-3 transition-transform group-hover:translate-y-px" />
          </span>
        </button>
      </div>

      {/* ── A. Greeting card ─────────────────────────────────────────────
          The first thing a signed-in customer sees on this screen: their own
          name, and a greeting that matches the time of day it actually is on
          their device — not the time of day on the build server.

          It sits directly under the location row because that is where the
          eye lands first, and the art behind it is admin-published (image or
          animated GIF) so the platform can be re-skinned without a deploy.

          The name candidates are in priority order: the public display name
          first (that is what other people see, and what the customer
          recognises themselves by), then the legal name, then the email local
          part as a last resort so the card is never blank. */}
      <div className="px-4 pt-4">
        <GreetingCard
          nameCandidates={[
            profile.displayName,
            profile.name,
            profile.email?.split("@")[0],
          ]}
        />
      </div>

      {/* ── B. Sponsored banner ──────────────────────────────────────────
          Admin-controlled: image, headline, subtitle and CTA all come from the
          admin portal. Renders nothing when no slot is live, so the categories
          below stay above the fold on a 360px phone. */}
      <div className="px-4 pt-4">
        <HeroBanner audience="customer" />
      </div>

      {/* Active delivery outranks everything below it — a customer with a rider
          en route is looking for the tracker, not the catalogue. */}
      {activeOrder && (
        <div className="px-4 pt-4">
          <ActiveDeliveryCard order={activeOrder} />
        </div>
      )}

      {/* Live overview map — always there, always one tap away. Even when no
          delivery is in transit, the screen is the same /tracking page: the
          customer's own deliveries across every status the map covers. It sits
          ABOVE the services row so a customer lands on it first and can track
          without scrolling; the active delivery card above it handles the
          in-transit case specifically.

          On a wide screen it collapses to a compact inline link beside the
          section header rather than a full-width card — a 4-line banner in a
          1200px column reads as an empty space with a border around it. */}
      <div className="px-4 pt-4">
        <Link
          href="/tracking"
          className="group flex w-full items-center gap-3 rounded-2xl border border-go/25 bg-go/5 p-4 transition hover:border-go/40 hover:bg-go/10 active:scale-[0.995] md:w-auto md:rounded-full md:border-transparent md:bg-transparent md:p-0 md:hover:bg-transparent"
        >
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-go/15 transition group-hover:scale-105 md:h-8 md:w-8 md:rounded-full">
            <Navigation className="h-5 w-5 text-go animate-pulse md:h-4 md:w-4" />
          </div>
          <span className="flex-1 md:hidden">
            <p className="text-sm font-bold text-go">Live delivery map</p>
            <p className="text-[11px] text-muted group-hover:text-go transition">
              Track all your orders on the inside map
            </p>
          </span>
          <span className="hidden items-center gap-1.5 text-xs font-semibold text-go transition group-hover:translate-x-0.5 md:flex">
            <Navigation className="h-3.5 w-3.5" />
            Live delivery map
          </span>
          <span className="flex items-center gap-1 text-xs font-semibold text-go transition group-hover:translate-x-0.5 md:hidden">
            View map &rarr;
          </span>
        </Link>
      </div>

      {/* ── C. Services ─────────────────────────────────────────────────
          The brief's identity row — GoFood, GoMart, GoPharma, GoExpress,
          GoRide, GoPay, Airtime, Services — each in a pastel disc.

          This REPLACES the merchant-derived category rail that sat here
          before. That rail was built from live shops, so in production (2
          shops) it rendered two chips that fit on screen and could not
          scroll, and it showed taxonomy names ("Clothing & Fashion") rather
          than the platform's own services. QuickServicesGrid already owned
          these eight with working modals and had become orphaned, so
          mounting it removes a second competing set instead of adding one.

          The full category directory still exists — it is what "View all"
          and the Services sheet both point at.

          WHY THE HEADER CARRIES A COUNT
          ------------------------------
          Eight service discs read as the whole catalogue. A customer
          shopping for hardware, a salon or a bookstore had no way to learn
          those categories exist — the eight tiles were the only category
          affordance on the screen, so the absence of a tile was read as the
          absence of the category. The count next to "View all" makes the row
          an obvious subset of something larger, and the button makes that
          larger thing one tap away. */}
      <section aria-label="Services" className="px-4 pt-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-bold text-fg">Services</h2>
          <Link
            href="/categories"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-go transition hover:text-go-2"
          >
            View all {CATEGORIES.length} categories &rarr;
          </Link>
        </div>
        <QuickServicesGrid />
      </section>

      {/* Search result count. Only shown when the customer has actually typed,
          so it never occupies the screen as "0 results" before they ask. */}
      {q.trim() && (
        <section aria-label="Search results" className="px-4 pt-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-fg">
              {merchantsLoading ? "Searching…" : `${searchHits} result${searchHits === 1 ? "" : "s"} for “${q.trim()}”`}
            </h2>
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="grid h-7 w-7 place-items-center rounded-full bg-elevated text-muted transition hover:bg-go hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {searchHits === 0 && !merchantsLoading && (
            <p className="mt-2 rounded-2xl border border-hairline bg-surface p-4 text-xs text-muted">
              Nothing matched. Try a shop name, or browse a category above.
            </p>
          )}
        </section>
      )}

      {/* ── D. Popular Picks ─────────────────────────────────────────────
          Curated, not the whole catalogue. "View all" goes to the category
          directory rather than to a page that used to be this one. */}
      <section aria-label="Popular picks" className="px-4 pt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-bold text-fg">Popular Picks</h2>
          <Link
            href="/categories"
            className="shrink-0 text-xs font-semibold text-go transition hover:text-go-2"
          >
            View all &rarr;
          </Link>
        </div>

        {merchantsLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="overflow-hidden rounded-2xl bg-ink">
                <div className="h-24 animate-pulse bg-ink-3" />
                <div className="space-y-2 p-3">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-ink-3" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-ink-3" />
                </div>
              </div>
            ))}
          </div>
        ) : picks.length === 0 ? (
          <div className="rounded-2xl bg-ink p-6 text-center">
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ink-3">
              <Store className="h-6 w-6 text-on-ink-muted" />
            </span>
            <h3 className="font-display text-sm font-semibold text-on-ink">Nothing nearby yet</h3>
            <p className="mx-auto mt-1 max-w-[28ch] text-xs leading-relaxed text-on-ink-muted">
              GoDoor is onboarding businesses in Masaka. We&apos;re finding shops near{" "}
              {displayAddress === "Detecting your location…" ? "you" : displayAddress.toLowerCase()} now
              — or set your address to widen the search.
            </p>
            <button
              type="button"
              onClick={() => setAddressSearchOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-go px-4 py-2 text-xs font-semibold text-white transition hover:bg-go-2 active:scale-95"
            >
              <MapPin className="h-3.5 w-3.5" />
              Set delivery address
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {picks.map((m) => {
              const dist = effectiveLoc ? distanceKm(effectiveLoc, m) : null;
              return (
                <Link
                  key={m.id}
                  href={`/app/merchant/${m.id}`}
                  className="group flex flex-col overflow-hidden rounded-2xl bg-ink text-on-ink shadow-card transition hover:shadow-pop active:scale-[0.98]"
                >
                  <div className="relative h-24 overflow-hidden bg-ink-3">
                    {m.logo_url ? (
                      <img
                        src={m.logo_url}
                        alt={m.name}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center">
                        <Store className="h-8 w-8 text-on-ink-muted" />
                      </span>
                    )}
                    {m.verified && (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-go px-2 py-0.5 text-[9px] font-bold text-white shadow-xs">
                        <BadgeCheck className="h-2.5 w-2.5" />
                        Verified
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); toggleFav(m.id); }}
                      aria-pressed={favIds.includes(m.id)}
                      aria-label={`${favIds.includes(m.id) ? "Remove" : "Add"} ${m.name} ${favIds.includes(m.id) ? "from" : "to"} favourites`}
                      className="tap-44 absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/35 backdrop-blur-sm transition active:scale-90"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden className={`h-3.5 w-3.5 ${favIds.includes(m.id) ? "fill-go text-go" : "fill-white/80 text-white/80"}`}>
                        <path d="M12 21s-7-4.35-9.33-8.24A5.5 5.5 0 0 1 12 6.5a5.5 5.5 0 0 1 9.33 6.26C19 16.65 12 21 12 21z" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex flex-1 flex-col p-3">
                    <h3 className="truncate text-sm font-bold leading-tight text-on-ink">{m.name || "Business"}</h3>
                    <p className="mt-0.5 truncate text-[11px] text-on-ink-muted">
                      {m.tagline || m.category || "Local business"}
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-2 text-[10px]">
                      <span className="inline-flex items-center gap-0.5 font-semibold text-warning">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        <span className="num">{m.rating || "New"}</span>
                      </span>
                      {dist !== null && (
                        <span className="inline-flex items-center gap-0.5 text-on-ink-muted">
                          <Navigation className="h-2.5 w-2.5" />
                          {formatDistance(dist)}
                        </span>
                      )}
                      <span className="text-on-ink-muted">
                        {m.delivery_fee_ugx === 0 ? (
                          "Free delivery"
                        ) : (
                          <span className="num">{Math.round(m.delivery_fee_ugx / 100) / 10}k delivery</span>
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── E. Reorder ───────────────────────────────────────────────────
          "Order again" is the highest-value action on the whole screen for a
          returning customer — it is faster than searching and it is what they
          came back to do. */}
      {!merchantsLoading && (
        <section aria-label="Reorder" className="px-4 pt-6">
          <QuickReorder />
        </section>
      )}

      <StoriesStrip stories={stories} onOpen={(idx) => setStoryViewerIdx(idx)} />

      {/* ── F. Wallet + trust ─────────────────────────────────────────── */}
      <section aria-label="GoDoor Wallet" className="px-4 pt-5">
        <Link
          href="/wallet"
          className="flex items-center gap-3 rounded-2xl bg-ink p-4 text-on-ink shadow-card transition hover:shadow-pop active:scale-[0.99]"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-go/15">
            <WalletIcon className="h-5 w-5 text-go" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">GoDoor Wallet</span>
            <span className="block text-[11px] text-on-ink-muted">
              Escrow-protected payments, funded from your Morse wallet
            </span>
          </span>
          <Gift className="h-4 w-4 shrink-0 text-on-ink-muted" aria-hidden />
        </Link>
      </section>

      {/* Trust strip — three claims the platform actually makes, in the place
          a customer decides whether to trust it. */}
      <section aria-label="Why GoDoor" className="px-4 pt-3">
        <div className="flex items-center justify-around gap-2 rounded-2xl border border-hairline bg-surface px-3 py-3">
          <TrustItem icon={ShieldCheck} label="Escrow protected" />
          <span className="h-6 w-px bg-hairline" aria-hidden />
          <TrustItem icon={Navigation} label="Live GPS" />
          <span className="h-6 w-px bg-hairline" aria-hidden />
          <TrustItem icon={BadgeCheck} label="Verified riders" />
        </div>
      </section>

      {/* Beyond the shelf: real customer features that were mounted only on the
          marketing page — which is the one screen a signed-in customer is
          never on. */}
      <div className="space-y-4 px-4 pt-6 pb-2 md:mx-auto md:max-w-3xl">
        <Favourites />
        <DeliveryPreference />
        <TableBooking />
      </div>

      {(role === "customer" || !onboarded) && <CustomerNav />}
      {storyViewerIdx !== null && (
        <StoryViewer stories={stories} initialIndex={storyViewerIdx} onClose={() => setStoryViewerIdx(null)} />
      )}
      <SignupModal open={signup.open} onClose={() => signup.setOpen(false)} returnTo={signup.returnTo} />
      <ProductSearch open={productSearchOpen} onClose={() => setProductSearchOpen(false)} />
      <AddressSearchModal
        open={addressSearchOpen}
        onClose={() => setAddressSearchOpen(false)}
        onSelect={handleAddressSelect}
      />
    </div>
  );
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

function TrustItem({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1 text-center">
      <Icon className="h-4 w-4 shrink-0 text-go" aria-hidden />
      <span className="truncate text-[10px] font-medium leading-tight text-fg">{label}</span>
    </span>
  );
}
