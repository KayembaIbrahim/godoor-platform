"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Bike, Wallet, ShoppingBag, User } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { useActiveOrder } from "@/lib/use-active-order";
import { cn } from "@/lib/utils";

/**
 * Bottom Navigation Bar for GoDoor customers.
 *
 * Matches the reference design with 5 tabs:
 * 1. Home (active by default on /app)
 * 2. GoRide (/ride)
 * 3. Pay (/wallet)
 * 4. Activity (/orders)
 * 5. Account (/account)
 *
 * GoDoor 2.0 update: Orange remains the primary brand color.
 * Purple is used strategically for selected states per the 50/50 color balance.
 */
const tabs = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/ride", label: "GoRide", icon: Bike },
  { href: "/wallet", label: "Pay", icon: Wallet },
  { href: "/orders", label: "Activity", icon: ShoppingBag },
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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 safe-area-bottom"
    >
      <div className="pointer-events-auto relative mx-auto max-w-lg lg:max-w-6xl border-t border-white/10 bg-[#0B132B]/95 backdrop-blur-2xl px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl">
        <div className="flex items-center justify-around">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = isTabActive(pathname, t.href);
            const isActivity = t.href === "/orders";

            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-1 px-1 transition-all duration-200 active:scale-95",
                  isActive
                    ? "text-white bg-purple/10"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {/* Active indicator capsule */}
                <div
                  className={cn(
                    "flex flex-col items-center justify-center rounded-2xl px-3 py-1 transition-all duration-200",
                    isActive
                      ? "bg-white/10 shadow-sm"
                      : "group-hover:bg-white/5"
                  )}
                >
                  <span className="relative">
                    <Icon
                      className={cn(
                        "h-5 w-5 transition-transform duration-200",
                        isActive && "scale-105 text-white"
                      )}
                    />
                    {/* Live delivery or cart indicator on Activity tab */}
                    {isActivity && (activeOrder || cartCount > 0) && (
                      <span
                        className="absolute -right-2 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-go px-1 text-[8px] font-bold text-white ring-2 ring-[#0B132B]"
                        aria-label="Active order or cart items"
                      >
                        {activeOrder ? "!" : cartCount}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 text-[10px] font-medium leading-none tracking-tight transition-colors",
                      isActive ? "font-bold text-white" : "text-slate-400 group-hover:text-slate-200"
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
