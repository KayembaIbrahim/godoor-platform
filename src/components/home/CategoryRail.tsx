"use client";

import Link from "next/link";
import { SERVICE_TILES } from "@/lib/service-tiles";
import { browseHref } from "@/lib/service-slugs";

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
 */

export default function CategoryRail() {
  return (
    <section id="categories" className="border-b border-border py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="font-display text-xl font-bold">What are you ordering?</h2>

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