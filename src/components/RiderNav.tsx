"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Clock, Wallet, User, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar for riders.
 *
 * THE LAYOUT: three tabs on one slab, two standing alone.
 * ---------------------------------------------------
 *   [ Home · Map · Earnings ]   (History) (Profile)
 *
 * "Map" points at /tracking, the shared live-map screen. It was removed
 * earlier on the grounds that it showed "the customer's tracking screen" —
 * but /tracking is not a customer's screen: with no order id it renders the
 * ROLE overview, and for a rider that means the routes assigned to them.
 * Without this tab a rider had no map of their own deliveries at all; the
 * only way in was opening a single delivery from the job list.
 *
 * The screen behind the tab is the same one the customer and the business
 * use — one map component, three role-scoped views of it.
 *
 * The split into a slab and two floating buttons mirrors the customer bar
 * exactly, so the app feels like ONE product rather than three dashboards
 * that happen to share a stylesheet. A rider is on the road: the three
 * things they reach for mid-shift (where am I, my map, my money) live on a
 * slab their thumb can sweep; History and Profile are deliberate journeys
 * and stand apart.
 */
const slabTabs = [
  { href: "/rider", label: "Home", icon: Home },
  { href: "/tracking", label: "Map", icon: MapIcon },
  { href: "/rider/earnings", label: "Earnings", icon: Wallet },
];

const floatTabs = [
  { href: "/rider/history", label: "History", icon: Clock },
  { href: "/account", label: "Profile", icon: User },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/rider") return pathname === "/rider";
  return pathname === href || pathname.startsWith(href + "/");
}

export function RiderNav() {
  const pathname = usePathname() || "/rider";

  return (
    <nav
      aria-label="Rider sections"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex w-full max-w-lg items-end justify-between gap-2">
        {/* ── The slab: three shift-critical tabs on one surface ──────────
            flex-1 so the slab GROWS to fill the space left by the two floating
            buttons — the old inline-flex slab sized itself to its content and
            every tab shrank to ~33 px, which is what truncated "Earnings" on
            a 320 px phone. The slab is also min-w-0 so it can shrink on the
            narrowest device instead of pushing the floats off the screen. */}
        <div className="nav3d pointer-events-auto flex flex-1 min-w-0 items-center gap-0.5 rounded-[26px] px-1.5 py-1.5">
          {slabTabs.map((t) => {
            const Icon = t.icon;
            const isActive = isTabActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                aria-label={t.label}
                className="group relative flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-[20px] active:scale-95"
              >
                <div
                  className={cn(
                    "nav3d-item flex min-h-10 w-full flex-col items-center justify-center gap-0.5 rounded-[17px] px-1 py-1.5",
                    isActive ? "nav3d-item-active" : "group-hover:bg-white/5"
                  )}
                >
                  <span className="relative">
                    <Icon
                      className={cn(
                        "h-5 w-5 transition-transform duration-200",
                        isActive ? "scale-105" : "group-hover:scale-110"
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      // Never truncated — a cut-off word reads as a broken
                      // screen. The slab grows to fill the row, so there is
                      // always room for the full label.
                      //
                      // 10px is the floor because "Earnings" is the longest
                      // label in the app and it has to fit a 320px phone: at
                      // 11px it cleared its slot by only 0.3px, which is one
                      // rounding difference from overlapping its neighbour.
                      "whitespace-nowrap text-[10px] font-semibold leading-tight sm:text-[11px] lg:text-xs",
                      isActive ? "font-bold" : "text-white/70"
                    )}
                  >
                    {t.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* ── The two standalone buttons ───────────────────────────────── */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {floatTabs.map((t) => {
            const Icon = t.icon;
            const isActive = isTabActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                aria-label={t.label}
                title={t.label}
                className="group relative flex min-h-11 min-w-11 items-center justify-center"
              >
                <div
                  className={cn(
                    "nav3d-float flex h-11 w-11 items-center justify-center rounded-full",
                    isActive && "nav3d-float-active"
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {isActive && <span className="nav3d-pip" />}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
