"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Clock, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom tab bar for riders.
 *
 * "Map" used to sit in this row and pointed at /tracking — the *customer's*
 * tracking screen, which asks for an order id and shows somebody else's
 * delivery. Riders get their map inside the active-delivery card where they
 * actually need it, so the dead tab is gone.
 */
const tabs = [
  { href: "/rider", label: "Home", icon: Home },
  { href: "/rider/earnings", label: "Earnings", icon: Wallet },
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
    <nav aria-label="Rider sections" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 safe-area-bottom">
      <div className="pointer-events-auto mx-auto flex max-w-lg items-center justify-around rounded-3xl border border-border bg-bg/85 px-1.5 py-1.5 shadow-floating backdrop-blur-2xl">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = isTabActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 transition-all duration-200 active:scale-90",
                isActive ? "text-primary" : "text-muted hover:text-fg"
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 rounded-2xl transition-all duration-200",
                  isActive ? "scale-100 bg-primary/12 opacity-100" : "scale-90 opacity-0"
                )}
                aria-hidden
              />
              <span className="relative">
                <Icon className={cn("h-5 w-5 transition-transform duration-200", isActive && "scale-110")} />
                {isActive && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />}
              </span>
              <span className={cn("relative text-[10px] font-medium leading-none", isActive && "font-semibold")}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
