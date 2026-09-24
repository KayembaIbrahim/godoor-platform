"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Package, ShoppingBag, Settings,
  Map as MapIcon, BadgeCheck, User, DollarSign, TrendingUp
} from "lucide-react";
import { useSession, roleHomePath } from "@/lib/session-store";

const MOBILE_NAV = [
  { href: "/business", label: "Home", icon: LayoutDashboard },
  { href: "/business/orders", label: "Orders", icon: Package },
  { href: "/business/products", label: "Products", icon: ShoppingBag },
  { href: "/business/store", label: "Store", icon: Settings },
  { href: "/account", label: "Profile", icon: User },
];

const DESKTOP_NAV = [
  ...MOBILE_NAV,
  { href: "/business/earnings", label: "Earnings", icon: TrendingUp },
  { href: "/tracking", label: "Live Map", icon: MapIcon },
  { href: "/verification", label: "Verification", icon: BadgeCheck },
];

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { onboarded, role } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Role guard: only business sees business tools — customer/rider get sent to their home
  useEffect(() => {
    if (!mounted) return;
    if (!onboarded) router.replace("/onboarding");
    else if (role !== "business" && role !== "admin") router.replace(roleHomePath(role));
  }, [mounted, onboarded, role, router]);

  return (
    <div className="min-h-[70vh] bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-surface/60 p-3 pt-20 md:flex">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-dim">Business tools</p>
        <nav className="flex-1 space-y-1">
          {DESKTOP_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/business" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-primary/12 text-primary ring-1 ring-primary/25" : "text-muted hover:bg-elevated hover:text-fg"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="px-3 pt-2 text-[10px] text-dim">GoDoor Business</p>
      </aside>

      {/* Content */}
      <div className="md:pl-56">{children}</div>

      {/* Mobile bottom tab bar — always visible */}
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-primary/20 bg-bg/95 backdrop-blur-xl md:hidden safe-area-bottom">
        <div className="mx-auto flex max-w-lg items-center justify-around py-1.5 px-2">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/business" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 transition-all ${
                  active ? "text-primary" : "text-muted hover:text-fg"
                }`}
              >
                {active && (
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 h-1 w-5 rounded-full bg-primary" />
                )}
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
