"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useCallback } from "react";
import {
  MapPin, Search, Star, Truck, ChevronDown, Bike,
  BadgeCheck, Heart, ShoppingBag, SlidersHorizontal, TrendingUp,
  X, MapPinned, Navigation, Zap, Clock, Flame,
} from "lucide-react";
import { ProductSearch } from "@/components/ProductSearch";
import { AboutGoDoor } from "@/components/AboutGoDoor";
import { QuickReorder } from "@/components/QuickReorder";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { StoriesStrip, StoryViewer, type Story } from "@/components/StoriesViewer";
import { useSession } from "@/lib/session-store";
import { useGeolocation, distanceKm, formatDistance, detectDistrict, type LatLng } from "@/lib/location";
import { useMerchants } from "@/lib/hooks";
import { CustomerNav } from "@/components/CustomerNav";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { useTrackingStore } from "@/lib/tracking-store";
import { useFavorites } from "@/lib/customer-stores";
import { getCategoryIcon } from "@/lib/categories";
import { AddressSearchModal, getLastAddress } from "@/components/AddressSearchModal";

type SortMode = "nearest" | "rating" | "popular";

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
  const { active: trackedDelivery } = useTrackingStore();
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

  // The effective location: searched address takes priority over GPS
  const effectiveLoc: LatLng | null = deliveryAddr
    ? { lat: deliveryAddr.lat, lng: deliveryAddr.lng }
    : gpsLoc;

  const displayAddress = deliveryAddr?.place
    || (locStatus === "locating" ? "Detecting location…" : "Set your delivery address");

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

  const categories = useMemo(() => [...new Set(merchants.map((m) => m.category))], [merchants]);
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
      if (cat !== "all" && m.category !== cat) return false;
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

  const areaHeading = activeDistrictName
    ? `${activeDistrictName} · ${list.length} business${list.length !== 1 ? "es" : ""}`
    : district === "auto" && locStatus === "locating"
      ? "Detecting your area…"
      : `${merchantsLoading ? "Loading businesses…" : `All Uganda · ${list.length} businesses`}`;

  const activeFilterCount = [minRating > 0, freeDeliveryOnly, verifiedOnly].filter(Boolean).length;

  const handleAddressSelect = useCallback((result: { place: string; lat: number; lng: number }) => {
    setDeliveryAddr(result);
  }, []);

  return (
    <div className="mx-auto min-h-[70vh] max-w-lg bg-bg pb-24 md:max-w-3xl lg:max-w-6xl">
      <header className="relative z-20 border-b border-border bg-bg/90 backdrop-blur-xl">
        <div className="space-y-2 px-4 pt-3 pb-3 md:mx-auto md:max-w-3xl">
          {/* Delivery address bar — Uber style */}
          <button
            type="button"
            onClick={() => setAddressSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-xs transition hover:border-go/40 hover:bg-elevated hover:shadow-card"
          >
            <MapPin className="h-4 w-4 text-go shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase font-semibold text-go tracking-wider">Deliver to</p>
              <p className="text-sm font-medium text-fg truncate">{displayAddress}</p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
          </button>

          {/* Active delivery banner */}
          {trackedDelivery && trackedDelivery.status !== "delivered" && (
            <Link href="/tracking" className="flex items-center gap-2 rounded-xl border border-go/30 bg-go/10 px-3 py-2.5 shadow-xs transition hover:bg-go/15">
              <Truck className="h-4 w-4 text-go animate-pulse" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-go">Live delivery in progress</p>
                <p className="text-[10px] text-muted truncate">{trackedDelivery.merchantName}</p>
              </div>
              <Navigation className="h-3.5 w-3.5 text-go" />
            </Link>
          )}

          {/* Search — tap to open full product search */}
          <button type="button" onClick={() => setProductSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-xs transition hover:border-go/40 hover:bg-elevated hover:shadow-card">
            <Search className="h-4 w-4 text-dim shrink-0" />
            <span className="text-sm text-muted">Search food, shops, anything…</span>
          </button>

          {/* Services — Food delivery + Boda ride (super-app grid seed) */}
          <div className="grid grid-cols-2 gap-2">
            <a href="#merchants"
              className="flex items-center gap-2.5 rounded-2xl border border-go/30 bg-go/10 px-3.5 py-3 transition hover:bg-go/15">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-go text-white">
                <ShoppingBag className="h-4.5 w-4.5" />
              </span>
              <span>
                <span className="block text-sm font-bold">Food & Shops</span>
                <span className="block text-[10px] text-muted">Order for delivery</span>
              </span>
            </a>
            <Link href="/ride"
              className="flex items-center gap-2.5 rounded-2xl border border-[#f97316]/30 bg-[#f97316]/10 px-3.5 py-3 transition hover:bg-[#f97316]/15">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f97316] text-white">
                <Bike className="h-4.5 w-4.5" />
              </span>
              <span>
                <span className="block text-sm font-bold">Boda Ride</span>
                <span className="block text-[10px] text-muted">Go anywhere now</span>
              </span>
            </Link>
          </div>

          {/* Sort + filter bar */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
              {(["nearest", "rating"] as SortMode[]).map((s) => (
                <button key={s} type="button" onClick={() => setSortMode(s)}
                  className={`shrink-0 chip transition ${sortMode === s ? "bg-go text-white" : "bg-elevated text-muted hover:bg-surface"}`}>
                  {s === "nearest" && <MapPin className="h-2.5 w-2.5" />}
                  {s === "rating" && <Star className="h-2.5 w-2.5" />}
                  {s === "nearest" ? "Nearby" : "Top rated"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowFilters(!showFilters)}
              className={`shrink-0 chip transition ${showFilters || activeFilterCount > 0 ? "bg-go text-white" : "bg-elevated text-muted hover:bg-surface"}`}>
              <SlidersHorizontal className="h-2.5 w-2.5" />
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="flex flex-wrap gap-1.5 animate-slide-down">
              <button type="button" onClick={() => setMinRating(minRating === 4 ? 0 : 4)}
                className={`flex items-center chip transition ${minRating === 4 ? "bg-warning/20 text-warning" : "bg-elevated text-muted"}`}>
                <Star className="h-2.5 w-2.5" /> 4+ stars
              </button>
              <button type="button" onClick={() => setFreeDeliveryOnly(!freeDeliveryOnly)}
                className={`flex items-center chip transition ${freeDeliveryOnly ? "bg-success/20 text-success" : "bg-elevated text-muted"}`}>
                Free delivery
              </button>
              <button type="button" onClick={() => setVerifiedOnly(!verifiedOnly)}
                className={`flex items-center chip transition ${verifiedOnly ? "bg-primary/20 text-primary" : "bg-elevated text-muted"}`}>
                <BadgeCheck className="h-2.5 w-2.5" /> Verified
              </button>
            </div>
          )}

          {/* Category chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button type="button" onClick={() => setCat("all")}
              className={`shrink-0 chip font-medium transition ${cat === "all" ? "bg-go text-white shadow-xs" : "bg-elevated text-muted hover:bg-surface"}`}>All</button>
            {categories.map((c) => {
              const CatIcon = getCategoryIcon(c);
              return (
                <button key={c} type="button" onClick={() => setCat(c)}
                  className={`shrink-0 flex items-center gap-1 chip transition ${cat === c ? "bg-go text-white shadow-xs" : "bg-elevated text-muted hover:bg-surface"}`}>
                  {CatIcon ? <CatIcon className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                  {c}
                </button>
              );
            })}
          </div>

          {/* District chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 border-t border-border pt-2">
            <button type="button" onClick={() => setDistrict(gpsDistrict || "auto")}
              className={`shrink-0 flex items-center gap-1 chip transition ${activeDistrictName === gpsDistrict && district !== "all" ? "bg-surface text-go ring-1 ring-go/40 shadow-xs" : "bg-elevated text-muted hover:bg-surface"}`}>
              <MapPin className="h-3 w-3 text-go" />{gpsDistrict || (locStatus === "locating" ? "Detecting…" : "Your area")}
            </button>
            <button type="button" onClick={() => setDistrict("all")}
              className={`shrink-0 chip transition ${district === "all" ? "bg-surface text-go ring-1 ring-go/40 shadow-xs" : "bg-elevated text-muted hover:bg-surface"}`}>
              All Uganda
            </button>
            {districts.filter((d) => d !== gpsDistrict).map((d) => (
              <button key={d} type="button" onClick={() => setDistrict(d)}
                className={`shrink-0 chip transition ${activeDistrictName === d ? "bg-surface text-go ring-1 ring-go/40 shadow-xs" : "bg-elevated text-muted hover:bg-surface"}`}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* First-order incentive */}
      {!onboarded && (
        <div className="mx-4 mt-3 rounded-2xl border border-go/30 bg-gradient-to-r from-go/10 to-go/5 p-4 shadow-xs">
          <p className="text-sm font-semibold">Free delivery on your first order</p>
          <p className="text-xs text-muted">Sign up to order from shops near you</p>
        </div>
      )}

      {/* GONEW — free service fee for new customers */}
      {!onboarded && (
        <Link href="/wallet" className="mx-4 mt-3 block rounded-2xl border border-go/40 bg-gradient-to-r from-go/15 via-primary/10 to-go/5 p-4 shadow-xs card-hover transition hover:border-go/60">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-fg num">Free 2,000 UGX service fee for new customers</p>
              <p className="mt-0.5 text-xs text-muted">GoDoor Gas Fee covers delivery &amp; service fees. Use promo code at signup, then top up from your Morse wallet when you run out.</p>
            </div>
            <span className="shrink-0 rounded-xl bg-go px-3 py-2 font-mono text-xs font-bold text-white shadow-xs num">GONEW</span>
          </div>
        </Link>
      )}

      <div className="space-y-4 px-4 pt-4">
        <StoriesStrip stories={stories} onOpen={(idx) => setStoryViewerIdx(idx)} />

        {/* How GoDoor works / why GoDoor — shown instead of promo ads while no promotions are live */}
        <AboutGoDoor />

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
                  className="shrink-0 w-40 tile shadow-xs card-hover p-3 transition hover:border-go/30">
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
            <Link key={m.id} href={`/app/merchant/${m.id}`} className="group block tile shadow-xs card-hover overflow-hidden animate-spring-in transition-all hover:border-go/40">
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
                  className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/30 backdrop-blur-sm transition active:scale-90">
                  <Heart className={`h-4 w-4 ${favIds.includes(m.id) ? "fill-go text-go" : "text-white"}`} />
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
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center md:col-span-2 lg:col-span-3">
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
              <button type="button" onClick={() => { setQ(""); setCat("all"); setDistrict("auto"); setMinRating(0); setFreeDeliveryOnly(false); setVerifiedOnly(false); }}
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
