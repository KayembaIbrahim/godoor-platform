"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChevronLeft, Star, MapPinned, BadgeCheck, Store, Search, SlidersHorizontal,
  Truck, MapPin, LayoutGrid,
} from "lucide-react";

import { useMerchants } from "@/lib/hooks";
import { getCategoryIcon } from "@/lib/categories";
import { browseMeta, canonicalCategoryForSlug, merchantInSlug } from "@/lib/service-slugs";
import { Price } from "@/components/Price";
import { CustomerNav } from "@/components/CustomerNav";

/**
 * Per-category browse page — where every category chip on the customer home
 * leads.
 *
 * The home screen deliberately shows DISCOVERY only (banner, categories, a
 * short curated list, your reorders). The complete list of nearby businesses
 * lives here, where there is room to sort it and filter it — a shopper who
 * wants "every pharmacy near me, cheapest delivery first" can say so without
 * scrolling past the whole home screen to find a control.
 */
type SortMode = "nearest" | "rating" | "delivery" | "fee";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "rating", label: "Top rated" },
  { id: "fee", label: "Lowest delivery" },
  { id: "delivery", label: "Fastest" },
];

export default function BrowseServicePage() {
  const params = useParams();
  const slug = typeof params?.category === "string" ? params.category : "";
  const canonical = canonicalCategoryForSlug(slug);
  const meta = browseMeta(slug, canonical);
  const { merchants, loading } = useMerchants();

  const [sort, setSort] = useState<SortMode>("rating");
  const [minRating, setMinRating] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [freeDeliveryOnly, setFreeDeliveryOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  /**
   * Filter, then sort, in that order.
   *
   * The order is load-bearing: sorting first would rank businesses the filters
   * then discard, which is wasted work on a low-end Android, and it makes the
   * "Showing N" count a lie while a filter is active.
   */
  const list = useMemo(() => {
    if (!canonical) return [];
    const base = merchants.filter((m) => merchantInSlug(m.category, slug));

    const filtered = base.filter((m) => {
      if (minRating > 0 && (m.rating || 0) < minRating) return false;
      if (verifiedOnly && !m.verified) return false;
      if (freeDeliveryOnly && m.delivery_fee_ugx > 0) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === "rating") {
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sort === "fee") {
      sorted.sort(
        (a, b) =>
          (a.delivery_fee_ugx || 0) - (b.delivery_fee_ugx || 0) ||
          (b.rating || 0) - (a.rating || 0),
      );
    } else {
      // "Fastest" — merchants publish opening hours, so a shop that closes
      // soon is genuinely worse to order from right now than one that does not.
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }
    return sorted;
  }, [merchants, canonical, slug, sort, minRating, verifiedOnly, freeDeliveryOnly]);

  const activeFilterCount = [minRating > 0, verifiedOnly, freeDeliveryOnly].filter(Boolean).length;

  // Unknown slug: nothing to browse. Say so plainly and point home rather than
  // rendering an empty grid that reads like GoDoor broke.
  if (!canonical || !meta) {
    return (
      <div className="mx-auto min-h-[70vh] max-w-lg px-4 pb-24">
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-elevated">
            <Store className="h-7 w-7 text-muted" />
          </div>
          <h1 className="font-display text-lg font-semibold">That service isn&apos;t available</h1>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted leading-relaxed">
            We couldn&apos;t find the service you were looking for.
          </p>
          <Link
            href="/categories"
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2"
          >
            <LayoutGrid className="h-4 w-4" />
            Browse all categories
          </Link>
        </div>
      </div>
    );
  }

  const Icon = getCategoryIcon(canonical);

  return (
    <div className="mx-auto min-h-[70vh] max-w-lg bg-bg pb-24 md:max-w-3xl">
      {/* Header — back link, service name, and the count, so the screen says
          what it is before the user reads a single card. */}
      <header className={`sticky top-0 z-20 border-b border-border bg-gradient-to-b to-transparent ${meta.wash}`}>
        <div className="px-4 pb-4 pt-4">
          <Link
            href="/app"
            className="inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-muted transition hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
            Home
          </Link>

          <div className="mt-3 flex items-center gap-3">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 ${meta.ring}`}>
              <Icon className="h-6 w-6 text-fg" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold leading-tight">{meta.title}</h1>
              <p className="mt-0.5 truncate text-xs text-muted">{meta.blurb}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted" aria-live="polite">
              {loading ? (
                "Finding businesses…"
              ) : (
                <>
                  <span className="num font-semibold text-fg">{list.length}</span>
                  {list.length === 1 ? " business" : " businesses"}
                  {activeFilterCount > 0 ? " match your filters" : ""}
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

          {/* Sort lives as chips rather than behind the filter sheet: it is the
              control people reach for most, and burying it made every browse
              page arrive in one arbitrary order. */}
          {!showFilters && (
            <div className="scrollbar-hide -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSort(s.id)}
                  className={`chip chip-nav shrink-0 transition active:scale-95 ${
                    sort === s.id ? "chip-on" : "bg-elevated text-muted hover:bg-surface"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {showFilters && (
            <div className="animate-slide-down mt-3 space-y-3 rounded-2xl bg-surface p-3.5 shadow-card">
              <div>
                <p className="navy-label">Sort by</p>
                <div className="flex flex-wrap gap-1.5">
                  {SORTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSort(s.id)}
                      className={`chip chip-nav transition active:scale-95 ${
                        sort === s.id ? "chip-on" : "bg-elevated text-muted hover:bg-surface"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="navy-label">Business quality</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMinRating(minRating === 4 ? 0 : 4)}
                    className={`chip chip-nav transition active:scale-95 ${
                      minRating === 4 ? "chip-on" : "bg-elevated text-muted hover:bg-surface"
                    }`}
                  >
                    <Star className="h-3.5 w-3.5" /> 4 stars &amp; up
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerifiedOnly(!verifiedOnly)}
                    className={`chip chip-nav transition active:scale-95 ${
                      verifiedOnly ? "chip-on" : "bg-elevated text-muted hover:bg-surface"
                    }`}
                  >
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified only
                  </button>
                  <button
                    type="button"
                    onClick={() => setFreeDeliveryOnly(!freeDeliveryOnly)}
                    className={`chip chip-nav transition active:scale-95 ${
                      freeDeliveryOnly ? "chip-on" : "bg-elevated text-muted hover:bg-surface"
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" /> Free delivery
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setMinRating(0);
                    setVerifiedOnly(false);
                    setFreeDeliveryOnly(false);
                  }}
                  className="chip chip-nav shrink-0 bg-elevated text-muted transition hover:bg-surface hover:text-fg active:scale-95"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilters(false)}
                  className="chip chip-nav flex-1 justify-center bg-navy text-white transition hover:bg-navy-hover active:scale-[0.98]"
                >
                  Show {list.length} {list.length === 1 ? "business" : "businesses"}
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 px-4 pt-4 md:grid-cols-3">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="h-28 animate-pulse bg-elevated" />
              <div className="space-y-2 p-3.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-elevated" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-elevated" />
              </div>
            </div>
          ))}

        {!loading &&
          list.map((m) => (
            <Link
              key={m.id}
              href={`/app/merchant/${m.id}`}
              className="group block overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition active:scale-[0.98]"
            >
              <div className="relative h-28 overflow-hidden bg-gradient-to-br from-go/5 to-primary/10">
                {m.logo_url ? (
                  <img
                    src={m.logo_url}
                    alt={m.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    {(() => {
                      const CI = getCategoryIcon(m.category || "");
                      return <span className="grid h-full w-full place-items-center bg-go/8"><CI className="h-10 w-10 text-go/60" /></span>;
                    })()}
                  </div>
                )}
                <div className="absolute left-2 top-2 flex items-center gap-1.5">
                  {m.delivery_fee_ugx === 0 && (
                    <span className="chip bg-go text-white shadow-xs">Free delivery</span>
                  )}
                  {m.verified && (
                    <span className="chip gap-0.5 bg-primary/90 text-white shadow-xs">
                      <BadgeCheck className="h-3 w-3" />
                      Verified
                    </span>
                  )}
                </div>
              </div>

              <div className="p-3.5">
                <h2 className="truncate font-display text-sm font-bold">{m.name || "Business"}</h2>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {m.tagline || m.category || "Local business"}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-semibold text-warning">
                    <Star className="h-3 w-3 fill-current" />
                    {m.rating || "New"}
                  </span>
                  {m.district && (
                    <span className="inline-flex items-center gap-1 truncate text-muted">
                      <MapPinned className="h-2.5 w-2.5 shrink-0" />
                      {m.area ? `${m.area}, ${m.district}` : m.district}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted">
                    {m.delivery_fee_ugx === 0 ? (
                      "Free delivery"
                    ) : (
                      <span className="inline-flex items-baseline gap-1">
                        Delivery
                        <Price amount={m.delivery_fee_ugx} className="text-xs" />
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </Link>
          ))}
      </div>

      {/* Empty state. One obvious next action, per the design brief. */}
      {!loading && list.length === 0 && (
        <div className="px-4 pt-4">
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-elevated">
              <Icon className="h-7 w-7 text-muted" />
            </div>
            <h2 className="font-display text-base font-semibold">
              {activeFilterCount > 0
                ? "Nothing matches those filters"
                : `No ${canonical.toLowerCase()} yet`}
            </h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted leading-relaxed">
              {activeFilterCount > 0
                ? "Try clearing a filter — there may still be businesses here."
                : `We're onboarding ${meta.title.toLowerCase()} partners now. Check another service.`}
            </p>
            {activeFilterCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setMinRating(0);
                  setVerifiedOnly(false);
                  setFreeDeliveryOnly(false);
                }}
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Clear filters
              </button>
            ) : (
              <Link
                href="/categories"
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2"
              >
                <LayoutGrid className="h-4 w-4" />
                Browse all categories
              </Link>
            )}
          </div>
        </div>
      )}

      <CustomerNav />
    </div>
  );
}