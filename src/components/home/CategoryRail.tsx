"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SERVICE_TILES } from "@/lib/service-tiles";
import { browseHref } from "@/lib/service-slugs";
import { CATEGORIES } from "@/lib/categories";

/**
 * One-tap category filtering on the marketing page.
 *
 * Deliberately four tiles, not twelve. The brief asks for Food, Groceries,
 * Pharmacy and Packages to be obvious; adding more dilutes that. Each tile
 * uses a tinted plate rather than a full-bleed colour so the four read as one
 * GoDoor ecosystem instead of four separate brands.
 *
 * The tile definitions live in `@/lib/service-tiles` because the signed-in
 * customer home renders the same four tiles. They used to be defined here and
 * separately in `CustomerHome.tsx`, which is how the two screens drifted into
 * looking like separate products — and how `packages` ended up as a tile
 * pointing at a category id that does not exist.
 *
 * WHY THERE IS A "VIEW ALL" BUTTON
 * ---------------------------------
 * Four tiles look like the whole catalogue. A visitor who wants to know what
 * else GoDoor sells had nowhere to go: the four tiles were the only category
 * affordance on the marketing page, so a shopper looking for "hardware" or
 * "salon" concluded GoDoor did not have it. The full directory lives at
 * `/categories` — it has always existed, it was simply never linked from the
 * page that most people land on.
 *
 * The button therefore carries the total count ("View all 24 categories") so
 * the teaser reads as a summary of something bigger rather than as a
 * complete set. The count is derived from `CATEGORIES`, the same source the
 * directory page renders, so the two can never disagree.
 */

export default function CategoryRail() {
  const totalCategories = CATEGORIES.length;

  return (
    <section id="categories" className="border-b border-border py-12">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold">What are you ordering?</h2>
            <p className="mt-1 text-sm text-muted">
              {totalCategories > SERVICE_TILES.length
                ? `Showing ${SERVICE_TILES.length} of ${totalCategories} categories`
                : "Browse by category"}
            </p>
          </div>

          {/* The catalogue is bigger than these four tiles. Make that visible
              and reachable, or the four tiles read as the whole list. */}
          {totalCategories > SERVICE_TILES.length && (
            <Link
              href="/categories"
              className="group inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-go transition hover:border-go/40 hover:bg-go/5"
            >
              View all {totalCategories} categories
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SERVICE_TILES.map(({ category, label, desc, Icon, tint, plate, ring }) => (
            <li key={category}>
              <Link
                href={browseHref(category)}
                className={`group flex min-h-11 flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:shadow-pop ${ring}`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-xl ${plate} ${tint}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-display text-sm font-bold">{label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{desc}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}