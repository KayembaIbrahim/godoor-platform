"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useCallback } from "react";
import {
  MapPin, Search, Star, Truck, ChevronDown, Bike,
  BadgeCheck, Heart, ShoppingBag, SlidersHorizontal, TrendingUp,
  X, MapPinned, Zap, Clock, Flame,
  Moon, Sun,
} from "lucide-react";
import { ProductSearch } from "@/components/ProductSearch";
import { AboutGoDoor } from "@/components/AboutGoDoor";
import { QuickReorder } from "@/components/QuickReorder";
import WalletBalanceCard from "@/components/WalletBalanceCard";
import ActiveDeliveryCard from "@/components/ActiveDeliveryCard";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { StoriesStrip, StoryViewer, type Story } from "@/components/StoriesViewer";
import { useSession } from "@/lib/session-store";
import { useGeolocation, distanceKm, formatDistance, detectDistrict, type LatLng } from "@/lib/location";
import { useMerchants } from "@/lib/hooks";
import { CustomerNav } from "@/components/CustomerNav";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { useActiveOrder } from "@/lib/use-active-order";
import { useFavorites } from "@/lib/customer-stores";
import { getCategoryIcon, categoryMatches, matchCategory } from "@/lib/categories";
import { AddressSearchModal, getLastAddress } from "@/components/AddressSearchModal";
import { QuickServicesGrid } from "@/components/QuickServicesGrid";

type SortMode = "nearest" | "rating" | "popular";

/** Plain-language progress for the live-order banner, per order status. */

export default function CustomerHome() {
  const { role, onboarded } = useSession();
  // Role guard: business/rider should never see the customer marketplace — redirect to their dashboard
  useEffect(() => {
    if (!onboarded) return;
    if (role === "business") window.location.href = "/business";
    else if (role === "rider") window.location.href = "/rider";
    else if (role === "admin") window.location.href = "/admin";
  }, [role, onboarded]);

  const [cat, setCat] = useState<string>("all");
  // Theme state: true = dark, false = light. Default to dark per GoDoor 2.0 brief.
  const [isDark, setIsDark] = useState<boolean>(true);

  const setTheme = (dark: boolean) => {
    setIsDark(dark);
    // Persist to localStorage so the choice survives page reloads
    if (typeof window !== "undefined") {
      localStorage.setItem("godoor-theme", dark ? "dark" : "light");
    }
  };

  // Initialize theme from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("godoor-theme");
    if (stored === "light") {
      setIsDark(false);
    }
  }, []);
  const [district, setDistrict] = useState<string>("auto");
  const [detectedDistrict, setDetectedDistrict] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stories, setStories] = useState<Story[]>([]);
  const [storyViewerIdx, setStoryViewerIdx] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("nearest");
  const [showFilters, setShowFilters] = useState(false);
  const [minRating, setMinRating] = useState<number>(0);
  const [freeDeliveryOnly, setFreeDeliveryOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);

  // Delivery address — either from search or from localStorage
  const [deliveryAddr, setDeliveryAddr] = useState<{ place: string; lat: number; lng: number } | null>(null);

  const cartCount = useCart((s) => s.count());
  const signup = useSignupPrompt();
  const { coords: gpsLoc, status: locStatus } = useGeolocation();
  // Server-truth live order. The old localStorage snapshot never cleared, so a
  // delivered order kept showing "Live delivery in progress" forever.
  const activeOrder = useActiveOrder();
  const { merchantIds: favIds, toggle: toggleFav } = useFavorites();
  const { merchants, loading: merchantsLoading } = useMerchants();

  // Load saved address on mount
  useEffect(() => {
    const saved = getLastAddress();
    if (saved) setDeliveryAddr(saved);
  }, []);

  useEffect(() => {
    fetch("/api/stories").then((r) => r.json()).then(({ stories: s }) => setStories(s || [])).catch(() => {});
  }, []);

  // The effective location: searched address takes priority over GPS.
  //
  // GPS is not guaranteed — permission can be denied, indoors can defeat a
  // fix, and on a weak connection the read can time out. When that happens the
  // catalogue still has to render, so fall back to the Kampala city centre
  // rather than leaving the map, sorting and district detection inert.
  const KAMPALA: LatLng = { lat: 0.3163, lng: 32.5822 };
  const effectiveLoc: LatLng | null = deliveryAddr
    ? { lat: deliveryAddr.lat, lng: deliveryAddr.lng }
    : gpsLoc ?? (locStatus === "denied" || locStatus === "idle" ? KAMPALA : null);

  // Tapping this opens the address picker, so the copy must stay actionable.
  // "Detecting location…" told the user nothing and, if the permission prompt
  // went unanswered, sat there indefinitely; a GPS read on a cold start also
  // routinely takes ~10s. "Set your delivery address" is always true and can
  // be acted on immediately, whether or not a fix eventually lands.
  const displayAddress = deliveryAddr?.place || "Set your delivery address";

  // Detect district from effective location
  useEffect(() => {
    if (!effectiveLoc) return;
    let cancelled = false;
    detectDistrict(effectiveLoc).then((d) => {
      if (cancelled) return;
      if (d) {
        setDetectedDistrict(d);
        setDistrict((cur) => (cur === "auto" ? d : cur));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [effectiveLoc?.lat, effectiveLoc?.lng]);

  // Chips are keyed by the CANONICAL category id, not the merchant's raw text.
// A shop registered as "Furniture " (trailing space) would otherwise produce a
// chip reading "Furniture " that matches nothing, and its count would disagree
// with what the filter actually returns.
  const categories = useMemo(
    () =>
      [
        ...new Set(
          merchants
            .map((m) => m.category)
            .filter(Boolean)
            .map((c) => matchCategory(c)?.id ?? c)
        ),
      ].sort(),
    [merchants],
  );

  /** How many shops sit behind each category chip, so nobody taps a dead end. */
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of merchants) {
      if (!m.category) continue;
      const id = matchCategory(m.category)?.id ?? m.category;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [merchants]);
  const districts = useMemo(() => {
    const set = [...new Set(merchants.map((m) => m.district || m.area || "Uganda"))];
    return set.sort((a, b) => a.localeCompare(b));
  }, [merchants]);

  const gpsDistrict = useMemo(() => {
    if (detectedDistrict) return detectedDistrict;
    if (!deliveryAddr?.place) return null;
    return districts.find((d) => deliveryAddr.place.toLowerCase().includes(d.toLowerCase())) || null;
  }, [detectedDistrict, deliveryAddr, districts]);

  const activeDistrictName = district === "all" ? null : district === "auto" ? (gpsDistrict || null) : district;

  const list = useMemo(() => {
    let filtered = merchants.filter((m) => {
      if (cat !== "all" && !categoryMatches(m.category, cat)) return false;
      const mDistrict = (m.district || m.area || "").toLowerCase();
      const hasDistrict = !!mDistrict && mDistrict !== "uganda";
      if (activeDistrictName && hasDistrict) {
        const aName = activeDistrictName.toLowerCase();
        // Match either direction (business in customer district OR customer district name appears in business district)
        const distMatch = mDistrict.includes(aName) || aName.includes(mDistrict);
        // Fallback: compare by area too — if business area mentions customer district
        const mArea = (m.area || "").toLowerCase();
        const areaMatch = mArea.includes(aName);
        if (!distMatch && !areaMatch) return false;
      }
      if (minRating > 0 && (m.rating || 0) < minRating) return false;
      if (freeDeliveryOnly && m.delivery_fee_ugx > 0) return false;
      if (verifiedOnly && !m.verified) return false;
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      const mArea = (m.area || "").toLowerCase();
      return m.name.toLowerCase().includes(s) || m.tagline.toLowerCase().includes(s) || mArea.includes(s) || mDistrict.includes(s) || (m.category || "").toLowerCase().includes(s);
    });

    const sorted = [...filtered];
    if (sortMode === "nearest" && effectiveLoc) {
      sorted.sort((a, b) => distanceKm(effectiveLoc, a) - distanceKm(effectiveLoc, b));
    } else if (sortMode === "rating") {
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else {
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }
    return sorted;
  }, [cat, activeDistrictName, q, effectiveLoc, merchants, sortMode, minRating, freeDeliveryOnly, verifiedOnly]);

  // "Detecting your area…" was gated purely on `locStatus === "locating"`, which
  // used to be able to stick permanently when the GPS read and IP fallback both
  // failed. Gate it on the merchants request actually being in flight instead,
  // so this always resolves to a real count.
  const areaHeading = activeDistrictName
    ? `${activeDistrictName} · ${list.length} business${list.length !== 1 ? "es" : ""}`
    : district === "auto" && merchantsLoading
      ? "Detecting your area…"
      : `${merchantsLoading ? "Loading businesses…" : `All Uganda · ${list.length} businesses`}`;

  const activeFilterCount = [minRating > 0, freeDeliveryOnly, verifiedOnly].filter(Boolean).length;

  const handleAddressSelect = useCallback((result: { place: string; lat: number; lng: number }) => {
    setDeliveryAddr(result);
  }, []);

  const clearAll = useCallback(() => {
    setQ("");
    setCat("all");
    setDistrict("auto");
    setMinRating(0);
    setFreeDeliveryOnly(false);
    setVerifiedOnly(false);
  }, []);

  return (
    <div className="mx-auto min-h-[70vh] max-w-lg pb-24 md:max-w-3xl lg:max-w-6xl">
      <header className="relative z-20 border-b border-border bg-navy/80 backdrop-blur-xl">
        {/* The page had no <h1> at all — headings jumped straight to merchant
            names, so assistive tech and crawlers had no page title. Kept
            screen-reader-only so the visual header is unchanged. */}
        <h1 className="sr-only">GoDoor — order food, groceries, rides and medicines in Uganda</h1>
        <div className="space-y-3 px-4 pt-3 pb-3 md:mx-auto md:max-w-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* GoDoor logo — the official current logo, unchanged */}
              <Link href="/app" className="group">
                <img
                  src="/logo.svg"
                  alt="GoDoor"
                  className="h-8 w-auto"
                />
              </Link>
              {/* Location selector */}
              <button
                type="button"
                onClick={() => setAddressSearchOpen(true)}
                className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:border-white/20 hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-go/40 focus:ring-offset-2"
              >
                <MapPin className="h-4 w-4 text-go" />
                <span className="hidden md:inline">Set delivery location</span>
              </button>
            </div>
            <div className="flex items-center gap-4">
              {/* Theme toggle */}
              <button
                type="button"
                onClick={() => setTheme(!isDark)}
                className="rounded-full p-1.5 bg-white/5 hover:bg-white/10 transition"
                aria-label="Toggle theme"
              >
                {isDark ? (
                  <Moon className="h-4 w-4 text-slate-300" />
                ) : (
                  <Sun className="h-4 w-4 text-slate-300" />
                )}
              </button>
            </div>
          </div>

          {/* GoDoor Pay wallet - premium wallet section */}
          <WalletBalanceCard className="border border-purple/20" />

          {/* Search — universal search across the entire GoDoor ecosystem */}
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#131F38] px-3.5 py-2.5 shadow-sm transition focus-within:border-purple/40">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search food, shops, groceries, medicines, rides..."
              aria-label="Search GoDoor ecosystem"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-slate-300 transition hover:bg-go hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setProductSearchOpen(true)}
                className="shrink-0 rounded-xl bg-[#1B2848] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#22335c] border border-white/5 active:scale-95"
              >
                All products
              </button>
            )}
          </div>

          {/* Active delivery tracker - prominent when order is active */}
          {activeOrder && (
            <div className="mt-4">
              <ActiveDeliveryCard order={activeOrder} className="border border-purple/20" />
            </div>
          )}

          {/* 8-item Super-App Grid & Safe Mobility banner */}
          <QuickServicesGrid
          onSelectCategory={(chosen) => setCat(chosen)}
          catCounts={catCounts}
        />

          {/* ── Catalogue nav ───────────────────────────────────────────
              One row answers "how many, sorted how", one rail switches
              category, and everything else lives behind a single Filter
              button. Three stacked scroll rows became one. */}
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted">
              {merchantsLoading ? (
                "Finding shops near you…"
              ) : (
                <>
                  <span className="num font-semibold text-fg">{list.length}</span>
                  {list.length === 1 ? " shop" : " shops"}
                  {activeDistrictName ? ` in ${activeDistrictName}` : " near you"}
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              className={`chip chip-nav shrink-0 transition active:scale-95 ${
                showFilters || activeFilterCount > 0
                  ? "chip-on"
                  : "bg-elevated text-muted hover:bg-surface"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </button>
          </div>

          {/* Category rail — the main way people shop. Counts on every chip so
              an empty category is obvious before it is tapped. */}
          <div className="scrollbar-hide -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 rail-fade">
            {[{ key: "all", label: "All", icon: null as any }, ...categories.map((c) => ({ key: c, label: c, icon: getCategoryIcon(c) }))].map((c) => {
              const on = cat === c.key;
              const Icon = c.icon;
              const count = c.key === "all" ? merchants.length : catCounts[c.key] || 0;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCat(c.key)}
                  aria-pressed={on}
                  disabled={c.key !== "all" && count === 0}
                  className={`chip chip-nav shrink-0 snap-start transition active:scale-95 ${
                    on
                      ? "chip-on"
                      : count === 0
                        ? "bg-elevated/60 text-dim opacity-60"
                        : "bg-elevated text-muted hover:bg-surface hover:text-fg"
                  }`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                  {c.label}
                  <span className={`num text-[10px] ${on ? "text-white/70" : "text-dim"}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Filter sheet — grouped, with a live "Show N shops" commit. */}
          {showFilters && (
            <div className="animate-slide-down space-y-4 rounded-2xl bg-surface p-3.5 shadow-card">
              <div>
                <p className="navy-label">Sort by</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["nearest", "rating"] as SortMode[]).map((s) => (
                    <button key={s} type="button" onClick={() => setSortMode(s)}
                      className={`chip chip-nav transition active:scale-95 ${sortMode === s ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                      {s === "nearest" ? <MapPin className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
                      {s === "nearest" ? "Nearest first" : "Top rated"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="navy-label">Shop quality</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setMinRating(minRating === 4 ? 0 : 4)}
                    className={`chip chip-nav transition active:scale-95 ${minRating === 4 ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                    <Star className="h-3.5 w-3.5" /> 4 stars &amp; up
                  </button>
                  <button type="button" onClick={() => setVerifiedOnly(!verifiedOnly)}
                    className={`chip chip-nav transition active:scale-95 ${verifiedOnly ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified only
                  </button>
                </div>
              </div>

              <div>
                <p className="navy-label">Delivery</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setFreeDeliveryOnly(!freeDeliveryOnly)}
                    className={`chip chip-nav transition active:scale-95 ${freeDeliveryOnly ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                    <Truck className="h-3.5 w-3.5" /> Free delivery
                  </button>
                </div>
              </div>

              <div>
                <p className="navy-label">Area</p>
                <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                  <button type="button" onClick={() => setDistrict(gpsDistrict || "auto")}
                    className={`chip chip-nav shrink-0 transition active:scale-95 ${activeDistrictName === gpsDistrict && district !== "all" ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                    <MapPin className="h-3.5 w-3.5" />{gpsDistrict || (locStatus === "locating" ? "Detecting…" : "Your area")}
                  </button>
                  <button type="button" onClick={() => setDistrict("all")}
                    className={`chip chip-nav shrink-0 transition active:scale-95 ${district === "all" ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                    All Uganda
                  </button>
                  {districts.filter((d) => d !== gpsDistrict).map((d) => (
                    <button key={d} type="button" onClick={() => setDistrict(d)}
                      className={`chip chip-nav shrink-0 transition active:scale-95 ${activeDistrictName === d ? "chip-on" : "bg-elevated text-muted hover:bg-surface"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-border pt-3">
                <button type="button" onClick={clearAll}
                  className="chip chip-nav shrink-0 bg-elevated text-muted transition hover:bg-surface hover:text-fg active:scale-95">
                  Clear all
                </button>
                <button type="button" onClick={() => setShowFilters(false)}
                  className="chip chip-nav flex-1 justify-center bg-navy text-white transition hover:bg-navy-hover active:scale-[0.98]">
                  Show {list.length} {list.length === 1 ? "shop" : "shops"}
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* First-order incentive */}
      {!onboarded && (
        <div className="mx-4 mt-3 rounded-2xl bg-gradient-to-r from-go/10 to-go/5 p-4 shadow-xs">
          <p className="text-sm font-semibold">Free delivery on your first order</p>
          <p className="text-xs text-muted">Sign up to order from shops near you</p>
        </div>
      )}

      {/* GONEW — free service fee for new customers */}
      {!onboarded && (
        <Link href="/wallet" className="mx-4 mt-3 block rounded-2xl bg-gradient-to-r from-go/15 via-primary/10 to-go/5 p-4 shadow-xs card-hover transition hover:bg-go/10">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-fg num">Free 2,000 UGX service fee for new customers</p>
              <p className="mt-0.5 text-xs text-muted">GoDoor Gas Fee covers delivery &amp; service fees. Use promo code at signup, then top up from your Morse wallet when you run out.</p>
            </div>
            <span className="shrink-0 rounded-xl bg-go px-3 py-2 font-mono text-xs font-bold text-white shadow-xs num">GONEW</span>
          </div>
        </Link>
      )}

      {/* How GoDoor works / why GoDoor. It sits outside the page padding so the
          navy band reaches both screen edges instead of floating inset. */}
      <AboutGoDoor />

      <div className="space-y-4 px-4 pt-4">
        <StoriesStrip stories={stories} onOpen={(idx) => setStoryViewerIdx(idx)} />

        {/* Quick reorder from past orders */}
        <QuickReorder />

        {/* Popular near you — trending section */}
        {effectiveLoc && list.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Flame className="h-4 w-4 text-go" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-dim">Popular near you</h3>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {list.slice(0, 4).map((m) => (
                <Link key={m.id} href={`/app/merchant/${m.id}`}
                  className="shrink-0 w-40 tile shadow-xs card-hover p-3 transition hover:bg-go/5">
                  <div className="h-16 w-full rounded-lg bg-gradient-to-br from-go/10 to-primary/10 flex items-center justify-center overflow-hidden">
                    {m.logo_url ? (
                      <img src={m.logo_url} alt={m.name} className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingBag className="h-6 w-6 text-go/30" />
                    )}
                  </div>
                  <p className="mt-2 text-xs font-semibold text-fg truncate">{m.name}</p>
                  <div className="mt-1 flex items-center gap-1 text-[10px]">
                    <Star className="h-2.5 w-2.5 fill-warning text-warning" />
                    <span className="num font-medium text-warning">{m.rating || "New"}</span>
                    <span className="text-dim">·</span>
                    <span className="text-muted">{m.delivery_fee_ugx === 0 ? "Free" : `${Math.round(m.delivery_fee_ugx / 1000)}k`}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p id="merchants" className="text-xs font-medium uppercase tracking-wider text-dim scroll-mt-32">{areaHeading}</p>
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3">
        {merchantsLoading && (
          <>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton h-28 w-full rounded-2xl" />
            ))}
          </>
        )}
        {!merchantsLoading && list.map((m) => {
          const dist = effectiveLoc ? distanceKm(effectiveLoc, m) : null;
          return (
            <Link key={m.id} href={`/app/merchant/${m.id}`} className="group block tile shadow-xs card-hover overflow-hidden animate-spring-in transition-all hover:bg-go/5">
              {/* Image area */}
              <div className="relative h-28 overflow-hidden bg-gradient-to-br from-go/5 to-primary/10">
                {m.logo_url ? (
                  <img src={m.logo_url} alt={m.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    {(() => { const CI = getCategoryIcon(m.category || ""); return <CI className="h-10 w-10 text-go/30" />; })()}
                  </div>
                )}
                {/* Overlay badges */}
                <div className="absolute top-2 left-2 flex items-center gap-1.5">
                  {m.delivery_fee_ugx === 0 && <span className="chip bg-go text-white shadow-xs">Free delivery</span>}
                  {m.verified && <span className="chip gap-0.5 bg-primary/90 text-white shadow-xs"><BadgeCheck className="h-3 w-3" /> Verified</span>}
                </div>
                <button type="button" onClick={(e) => { e.preventDefault(); toggleFav(m.id); }}
                  aria-pressed={favIds.includes(m.id)}
                  aria-label={`${favIds.includes(m.id) ? "Remove" : "Add"} ${m.name} ${favIds.includes(m.id) ? "from" : "to"} favourites`}
                  className="tap-44 absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/30 backdrop-blur-sm transition active:scale-90">
                  <Heart aria-hidden className={`h-4 w-4 ${favIds.includes(m.id) ? "fill-go text-go" : "text-white"}`} />
                </button>
                {cartCount > 0 && (
                  <div className="absolute bottom-2 right-2 rounded-full bg-go px-2 py-0.5 text-[10px] font-bold text-white shadow-xs num">Cart · {cartCount}</div>
                )}
              </div>
              {/* Info area */}
              <div className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-sm font-bold truncate">{m.name || "Business"}</h2>
                    <p className="mt-0.5 text-xs text-muted truncate">{m.tagline || m.category || "Local business"}</p>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-semibold text-warning">
                    <Star className="h-3 w-3 fill-current" />{m.rating || "New"}
                  </span>
                  {m.district && (
                    <span className="inline-flex items-center gap-1 text-muted">
                      <MapPinned className="h-2.5 w-2.5" />{m.area && m.district ? `${m.area}, ${m.district}` : m.district}
                    </span>
                  )}
                  {dist !== null && <span className="font-semibold text-go">{formatDistance(dist)}</span>}
                  <span className="text-muted">{m.delivery_fee_ugx === 0 ? "Free delivery" : <span className="inline-flex items-baseline gap-1">From <Price amount={m.delivery_fee_ugx} className="text-xs" /></span>}</span>
                </div>
              </div>
            </Link>
          );
        })}
        {list.length === 0 && !merchantsLoading && (
          <div className="rounded-2xl bg-surface/60 p-8 text-center md:col-span-2 lg:col-span-3">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-go/10">
              <ShoppingBag className="h-7 w-7 text-go" />
            </div>
            <h3 className="font-display text-base font-semibold">No businesses here yet</h3>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted leading-relaxed">
              {activeDistrictName
                ? `No businesses found in ${activeDistrictName}. Try another district.`
                : q || cat !== "all"
                  ? "Try a different search or category."
                  : "GoDoor is growing. Set your delivery address to find nearby shops."}
            </p>
            {(q || cat !== "all" || activeDistrictName || activeFilterCount > 0) ? (
              <button type="button" onClick={clearAll}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 transition">
                <Search className="h-3.5 w-3.5" /> Clear all filters
              </button>
            ) : (
              <button type="button" onClick={() => setAddressSearchOpen(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 transition">
                <MapPin className="h-3.5 w-3.5" /> Set delivery address
              </button>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Only customer sees the customer bottom nav — business/rider have their own */}
      {(role === "customer" || !onboarded) && <CustomerNav />}
      {storyViewerIdx !== null && (
        <StoryViewer stories={stories} initialIndex={storyViewerIdx} onClose={() => setStoryViewerIdx(null)} />
      )}
      <SignupModal open={signup.open} onClose={() => signup.setOpen(false)} returnTo={signup.returnTo} />
      <ProductSearch open={productSearchOpen} onClose={() => setProductSearchOpen(false)} />

      {/* Address search modal */}
      <AddressSearchModal
        open={addressSearchOpen}
        onClose={() => setAddressSearchOpen(false)}
        onSelect={handleAddressSelect}
      />
    </div>
  );
}
