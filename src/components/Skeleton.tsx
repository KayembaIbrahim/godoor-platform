"use client";

import { clsx } from "clsx";

/**
 * Reusable shimmering placeholder blocks, so every page can show a neutral
 * skeleton while its real content loads instead of a blank screen or a long
 * white flash.
 *
 * The sweep animation is defined in `globals.css` as `skeleton-sweep`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden rounded-md bg-elevated", className)}>
      <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[skeleton-sweep_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

/** A card-shaped placeholder — the base for every list and grid skeleton. */
export function SkeletonCard({ className }: { className?: string }) {
  return <Skeleton className={clsx("rounded-2xl", className)} />;
}

/** A stack of product/merchant cards, matching the catalogue layout. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="space-y-3">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-5/6 rounded" />
        </li>
      ))}
    </ul>
  );
}

/** A horizontal row placeholder — the catalogue's list-row shape. */
export function SkeletonCardRow() {
  return (
    <li className="flex items-stretch gap-3 py-2">
      <Skeleton className="h-16 shrink-0 w-28 rounded-l-xl border-r border-border" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-3 w-1/2 rounded" />
        <Skeleton className="h-2 w-1/3 rounded" />
      </div>
      <Skeleton className="h-16 shrink-0 w-36 rounded-r-xl" />
    </li>
  );
}

/** A grid of tile placeholders — category rails and product grids. */
export function SkeletonGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={clsx("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-2xl" />
      ))}
    </div>
  );
}
