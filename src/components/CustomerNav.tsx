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
 * Five tabs, and only five:
 *   1. Home       /app
 *   2. Categories /categories
 *   3. Orders     /orders
 *   4. Wallet     /wallet
 *   5. Account    /account
 *
 * The previous set was Home / GoRide / Pay / Activity / Account. "GoRide" put
 * a single vertical in the primary navigation while burying the directory that
 * actually answers "what can I order here" behind the home screen, and "Pay"
 * and "Wallet" were the same destination under two names — which is the sort
 * of duplication that makes an app feel like it has more surface than it needs.
 * A bottom bar is thumb-reach real estate: every extra item costs reach on the
 * one row a customer uses with the same hand as the back button.
 */
const tabs = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/categories", label: "Categories", icon: LayoutGrid },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
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
      {/* The bar used to be full-bleed: it ran edge to edge with a flat top
          border and no corner radius, which is why it read as a heavy strip
          rather than a control. It is now inset from both sides and fully
          rounded, so the glass capsule floats above the content and the
          blurred page shows through the gap beside it.

          `px-4` on the outer wrapper is the inset; `max-w-md` keeps it a
          comfortable thumb reach on a tablet instead of stretching it across
          the whole screen. The bottom padding collapses to 0 on a home-indicator
          device, because the indicator itself provides that space. */}
      <div className="mx-auto w-full max-w-md px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <div className="nav-float pointer-events-auto flex items-center justify-around gap-0.5 rounded-[26px] px-1.5 py-1.5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = isTabActive(pathname, t.href);
            const isOrders = t.href === "/orders";

            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // min-h-11 keeps the tap target at 44px even though the
                  // visible pill is shorter — the curve makes the control
                  // look smaller than it is, so the hit area has to be explicit.
                  "group relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-[20px] px-1 py-1 transition-all duration-200 active:scale-95",
                  isActive ? "text-brand" : "text-muted hover:text-fg"
                )}
              >
                {/* Active indicator capsule */}
                <div
                  className={cn(
                    "flex flex-col items-center justify-center rounded-[16px] px-3 py-1 transition-all duration-200",
                    isActive ? "nav-float-active" : "group-hover:bg-elevated"
                  )}
                >
                  <span className="relative">
                    <Icon
                      className={cn(
                        "h-5 w-5 transition-transform duration-200",
                        isActive && "scale-105"
                      )}
                    />
                    {/* Live delivery or cart indicator on the Orders tab */}
                    {isOrders && (activeOrder || cartCount > 0) && (
                      <span
                        className="absolute -right-2 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-go px-1 text-[8px] font-bold text-white ring-2 ring-bg"
                        aria-label="Active order or cart items"
                      >
                        {activeOrder ? "!" : cartCount}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      // `truncate` rather than nothing: "Categories" is the
                      // longest label on the bar, and without it the text
                      // overflows its 20%-width cell on a 320px phone and
                      // collides with the neighbouring tab's label.
                      "mt-0.5 max-w-full truncate text-[10px] font-medium leading-none tracking-tight transition-colors",
                      isActive ? "font-bold text-brand" : "text-muted group-hover:text-fg"
                    )}
                  >
                    {t.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
