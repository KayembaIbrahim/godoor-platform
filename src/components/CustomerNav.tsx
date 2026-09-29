"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, User, ShoppingCart, Bike } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar for customers.
 *
 * Two things make it feel broken if you get them wrong:
 *  - The active tab must come from `usePathname()`. A `popstate` listener only
 *    fires on back/forward, so tapping a <Link> left the old tab highlighted.
 *  - Cart carries a live item count. Without it people cannot tell whether
 *    anything is in there, so they re-browse the whole shop list to find out.
 */
const tabs = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/ride", label: "GoBoda", icon: Bike },
  { href: "/cart", label: "Cart", icon: ShoppingCart },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/account", label: "Account", icon: User },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app" || pathname.startsWith("/app/");
  return pathname === href || pathname.startsWith(href + "/");
}

export function CustomerNav() {
  const pathname = usePathname() || "/app";
  const cartCount = useCart((s) => s.count());

  return (
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 safe-area-bottom">
      <div className="pointer-events-auto relative flex items-center justify-around border-t border-white/8 bg-gradient-to-t from-black/25 via-black/10 to-transparent px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = isTabActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 transition-all duration-200 active:scale-90",
                isActive ? "text-white" : "text-slate-400 hover:text-slate-100"
              )}
            >
              <span
                className={cn(
                  "absolute -top-[9px] h-0.5 rounded-full bg-primary transition-all duration-300",
                  isActive ? "w-8 opacity-100" : "w-0 opacity-0"
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "absolute inset-0 rounded-2xl transition-all duration-200",
                  isActive ? "scale-100 bg-white/10 opacity-100" : "scale-90 opacity-0 group-hover:opacity-100 group-hover:bg-white/5"
                )}
                aria-hidden
              />
              <span className="relative">
                <Icon className={cn("h-5 w-5 transition-transform duration-200", isActive && "scale-110")} />
                {t.href === "/cart" && cartCount > 0 && (
                  <span
                    className="num absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-white ring-2 ring-navy-deep"
                    aria-label={`${cartCount} items in cart`}
                  >
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </span>
              <span className={cn("relative text-[10px] font-medium leading-none transition-colors", isActive && "font-semibold text-white")}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
