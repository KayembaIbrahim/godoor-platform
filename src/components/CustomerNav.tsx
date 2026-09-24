"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Home, ShoppingBag, User, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/app", label: "Home", icon: Home },
  { href: "/cart", label: "Cart", icon: ShoppingCart },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/account", label: "Account", icon: User },
];

export function CustomerNav() {
  const [active, setActive] = useState("/app");

  useEffect(() => {
    setActive(window.location.pathname);
    const handler = () => setActive(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 px-3 pb-3 safe-area-bottom pointer-events-none">
      <div className="pointer-events-auto mx-auto flex max-w-lg items-center justify-around rounded-3xl border border-border bg-bg/85 px-2 py-2 shadow-floating backdrop-blur-2xl">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.href || (t.href === "/app" && active.startsWith("/app"));
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 transition-all duration-200 active:scale-90",
                isActive ? "text-go" : "text-muted hover:text-fg"
              )}
            >
              <span
                className={cn(
                  "absolute inset-0 rounded-2xl transition-all duration-200",
                  isActive ? "bg-go/12 scale-100 opacity-100" : "scale-90 opacity-0"
                )}
                aria-hidden
              />
              <span className="relative">
                <Icon className={cn("h-5 w-5 transition-transform duration-200", isActive && "scale-110")} />
                {isActive && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-go" />}
              </span>
              <span className={cn("relative text-[10px] font-medium", isActive && "font-semibold")}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}