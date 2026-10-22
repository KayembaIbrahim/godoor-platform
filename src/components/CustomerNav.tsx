"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, ShoppingBag, Wallet, User } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { useActiveOrder } from "@/lib/use-active-order";
import { cn } from "@/lib/utils";

/**
 * Bottom Navigation Bar for GoDoor customers.
 *
 * THE LAYOUT: three tabs on one bar, two standing alone.
 * ---------------------------------------------------
 *   [ Home · Categories · Orders ]   (Wallet) (Account)
 *
 * The previous bar was five equal tabs on one strip. Every one of them looked
 * identical, so the eye had nothing to land on and the thumb had to guess.
 * Splitting the set is a hierarchy decision, not a decoration:
 *
 *   • The SLAB holds the journey — where am I, what can I order, what is
 *     happening to my order. Three tabs, one black surface, one sweep of the
 *     thumb. The selected tab physically rises out of the slab as a lit
 *     orange key, so "which tab am I on" is answered by the shape before
 *     the colour is even read.
 *
 *   • The two FLOATING buttons are the destinations a user goes to
 *     deliberately — money and identity. They stand outside the slab with
 *     their own silhouette and their own shadow, because they are a
 *     different KIND of action: not "browse here" but "go here".
 *
 * Five loose equal-weight tabs was the most forgettable possible version of
 * this screen. The two-surface split gives every control a job.
 */
const slabTabs = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/categories", label: "Browse", icon: LayoutGrid },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
];

const floatTabs = [
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/account", label: "Account", icon: User },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app" || pathname.startsWith("/app/");
  return pathname === href || pathname.startsWith(href + "/");
}

export function CustomerNav() {
  const pathname = usePathname() || "/app";
  const cartCount = useCart((s) => s.count());
  const activeOrder = useActiveOrder();

  return (
    <nav
      aria-label="Bottom Navigation"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
    >
      {/* Inset from both sides so the blurred page shows through the gap
          beside the bar, and capped at `max-w-md` so it stays a comfortable
          thumb reach on a tablet instead of stretching across the screen.
          The bottom padding collapses to 0 on a home-indicator device,
          because the indicator itself provides that space. */}
      <div className="mx-auto flex w-full max-w-md items-end justify-between gap-2 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        {/* ── The slab: three journey tabs on one black surface ───────────
            flex-1 so the slab GROWS to fill the space left by the two floating
            buttons — the old inline-flex slab sized itself to its content and
            every tab shrank to ~33 px, which is what truncated "Browse" and
            "Earnings" on a 320 px phone. The slab is also min-w-0 so it can
            shrink on the narrowest device instead of pushing the floats off
            the screen. */}
        <div className="nav3d pointer-events-auto flex flex-1 min-w-0 items-center gap-0.5 rounded-[26px] px-1.5 py-1.5">
          {slabTabs.map((t) => {
            const Icon = t.icon;
            const isActive = isTabActive(pathname, t.href);
            const isOrders = t.href === "/orders";

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
                    {/* Live delivery or cart indicator on the Orders tab */}
                    {isOrders && (activeOrder || cartCount > 0) && (
                      <span
                        className={cn(
                          "absolute -right-2 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[8px] font-bold ring-2",
                          isActive
                            ? "bg-white text-primary ring-primary"
                            : "bg-go text-white ring-bg"
                        )}
                        aria-label="Active order or cart items"
                      >
                        {activeOrder ? "!" : cartCount}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      // The label is NEVER truncated. A cut-off word reads as a
                      // broken screen, and the slab now grows to fill the row
                      // so there is always room for it. `whitespace-nowrap`
                      // keeps a two-word label on one line.
                      //
                      // 10px is the floor because "Browse" has to fit a 320px
                      // phone alongside two floating buttons; it clears its
                      // slot by 7px at 11px, and 10px buys back more.
                      "whitespace-nowrap text-[10px] font-semibold leading-tight tracking-normal sm:text-[11px] lg:text-xs",
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

        {/* ── The two standalone buttons: outside the slab, on their own ── */}
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
