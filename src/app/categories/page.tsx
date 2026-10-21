"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Search, Store, SlidersHorizontal } from "lucide-react";

import { useMerchants } from "@/lib/hooks";
import { CATEGORIES, matchCategory } from "@/lib/categories";
import { CORE_RAIL_CATEGORIES, RAIL_LABELS } from "@/lib/service-tiles";
import { browseHref } from "@/lib/service-slugs";
import { discRgb as sharedDiscRgb } from "@/lib/category-discs";
import { CustomerNav } from "@/components/CustomerNav";

/**
 * The full category directory — the "Categories" tab in the bottom nav.
 *
 * WHY THIS PAGE IS SEPARATE FROM THE HOME RAIL
 * --------------------------------------------
 * The home screen shows a short, horizontal rail of the categories worth
 * leading with. A rail is a tease, not an index: a shopper who wants "show me
 * everything GoDoor sells in Masaka" cannot scroll a single row to find out
 * whether a category exists. This is that index.
 *
 * It also gives the customer a way back into the platform when they tap a
 * category that has no businesses yet — the rail chip leads to a browse page
 * whose empty state says "we're onboarding partners", and this is where they go
 * to find the ones that actually have shops today.
 */

/**
 * Pastel disc colours.
 *
 * These used to be a private copy of the palette, which meant the catalogue
 * screen and the home rail could show DIFFERENT colours for the same category
 * — the rail was slate for most categories while this page was a full rainbow.
 * Two screens of the same app should never disagree about what "Pharmacy"
 * looks like, so the shared module is the only source of truth now.
 */
function discRgb(id: string): string {
  return sharedDiscRgb(id);
}

export default function CategoriesPage() {
  const { merchants, loading } = useMerchants();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of merchants) {
      if (!m.category) continue;
      const id = matchCategory(m.category)?.id ?? m.category;
      counts[id] = (counts[id] || 0) + 1;
    }

    // Headline verticals first, then the rest of the core rail, then anything
    // else the taxonomy defines, then categories a live shop sits in that the
    // taxonomy has not caught up with. Same precedence the home rail uses, so
    // the two screens never disagree about what GoDoor considers primary.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of [...CORE_RAIL_CATEGORIES]) {
      if (!seen.has(id)) { seen.add(id); ordered.push(id); }
    }
    for (const c of CATEGORIES) {
      if (!seen.has(c.id)) { seen.add(c.id); ordered.push(c.id); }
    }
    for (const id of Object.keys(counts)) {
      if (!seen.has(id)) { seen.add(id); ordered.push(id); }
    }

    const needle = q.trim().toLowerCase();
    return ordered
      .filter((id) => !needle || id.toLowerCase().includes(needle) || (RAIL_LABELS[id] ?? "").toLowerCase().includes(needle))
      .map((id) => ({
        id,
        label: RAIL_LABELS[id] ?? id,
        count: counts[id] ?? 0,
      }));
  }, [merchants, q]);

  const openCount = rows.filter((r) => r.count > 0).length;

  return (
    <div className="mx-auto min-h-[70vh] max-w-lg bg-bg pb-24 md:max-w-3xl">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur-xl">
        <div className="px-4 pb-4 pt-4">
          <Link
            href="/app"
            className="inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-muted transition hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
            Home
          </Link>

          <h1 className="mt-3 font-display text-xl font-bold leading-tight">All categories</h1>
          <p className="mt-0.5 text-xs text-muted" aria-live="polite">
            {loading
              ? "Loading categories…"
              : `${openCount} of ${rows.length} categories have businesses near you`}
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 shadow-sm focus-within:border-go/40">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search categories"
              aria-label="Search categories"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear category search"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-elevated text-muted transition hover:bg-go hover:text-white"
              >
                <span aria-hidden>&times;</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="px-4 pt-4">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-8 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-elevated">
              <Search className="h-7 w-7 text-muted" />
            </div>
            <h2 className="font-display text-base font-semibold">No category matches “{q}”</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted leading-relaxed">
              Try a shorter word — “food”, “pharmacy”, “fuel”.
            </p>
            <button
              type="button"
              onClick={() => setQ("")}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2"
            >
              Clear search
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={browseHref(r.id)}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-all duration-200 hover:border-go/40 hover:shadow-[0_10px_24px_-8px_rgb(0_0_0/0.22)] active:scale-[0.98] active:shadow-none"
                >
                  <CategoryDisc id={r.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg transition-colors group-hover:text-go">{r.label}</span>
                    <span className="block text-[11px] text-muted">
                      {r.count > 0 ? (
                        <>
                          <span className="num">{r.count}</span> {r.count === 1 ? "business" : "businesses"}
                        </>
                      ) : (
                        "Coming soon"
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CustomerNav />
    </div>
  );
}

/** Pastel circle + category glyph, shared by every row on this page. */
function CategoryDisc({ id }: { id: string }) {
  const meta = CATEGORIES.find((c) => c.id === id);
  const Icon = meta?.icon ?? Store;
  return (
    <span
      className="hybrid-disc h-11 w-11 shrink-0"
      style={{ ["--disc-rgb" as string]: discRgb(id) }}
      aria-hidden
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}