"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Package,
  Map as MapIcon, BadgeCheck, User, DollarSign, TrendingUp, CalendarCheck
} from "lucide-react";
import { useSession, roleHomePath } from "@/lib/session-store";

const MOBILE_NAV = [
  { href: "/business", label: "Home", icon: LayoutDashboard },
  { href: "/business/orders", label: "Orders", icon: Package },
  { href: "/business/bookings", label: "Bookings", icon: CalendarCheck },
  /* The live map is a FIRST-CLASS destination for a business, so it is in
     the mobile bar too — it used to live only in the desktop sidebar, which
     meant a business on a phone had no way to watch its riders at all. */
  { href: "/tracking", label: "Live Map", icon: MapIcon },
  { href: "/account", label: "Profile", icon: User },
];

/* The mobile bar is split the same way the customer and rider bars are: the
   three things a business does all day (watch orders, take bookings, watch
   its riders) share ONE black slab, and the rest stand alone as raised
   buttons. Seven equal tabs on one strip was unreadable on a 360px phone —
   every label was truncated and none of them had any visual weight.

   WHY ONLY TWO FLOATING BUTTONS
   ----------------------------
   Every floating button is 44px plus an 8px gap, and those pixels come
   straight out of the slab. Three of them left "Bookings" 10px wider than
   the slot it had to fit in, so it overlapped its neighbour on a 360px phone.

   "Store" and "Products" were the two that had to go. Both are still one tap
   away — the dashboard has a tile for each, and the header menu lists them —
   but neither is something a business opens every few minutes, while orders
   and bookings are. What is left is the pair a business genuinely reaches
   for: the live map (their riders, right now) and their own profile. */
const MOBILE_SLAB = MOBILE_NAV.slice(0, 3);
const MOBILE_FLOAT = MOBILE_NAV.slice(3);

const DESKTOP_NAV = [
  ...MOBILE_NAV,
  { href: "/business/earnings", label: "Earnings", icon: TrendingUp },
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

      {/* Mobile bottom tab bar — always visible.
          Three tabs on one black slab, the rest as raised standalone buttons.
          The bar floats above the content instead of being a full-bleed strip
          with a hairline border, so it reads as an object sitting on the page
          rather than a seam across it. */}
      <nav
        aria-label="Business sections"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="mx-auto flex w-full max-w-lg items-end justify-between gap-2">
          {/* flex-1 so the slab GROWS to fill the row instead of sizing itself
              to its content. The old content-sized slab gave each of the
              three tabs ~30 px, which is why "Bookings" was always clipped. */}
          <div className="nav3d pointer-events-auto flex flex-1 min-w-0 items-center gap-0.5 rounded-[26px] px-1.5 py-1.5">
            {MOBILE_SLAB.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/business" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className="group relative flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-[20px] active:scale-95"
                >
                  <div
                    className={`nav3d-item flex min-h-10 w-full flex-col items-center justify-center gap-0.5 rounded-[17px] px-1 py-1.5 ${
                      active ? "nav3d-item-active" : "group-hover:bg-white/5"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {/* Never truncated — a clipped word reads as a broken
                        screen. The slab now fills the row, so the full label
                        always has room. 10px is the floor: it is the smallest
                        that stays legible on a phone, and it is what lets
                        "Bookings" — the longest label in the app — fit its
                        slot on a 320px screen. */}
                    <span className={`whitespace-nowrap text-[10px] font-semibold leading-tight sm:text-[11px] ${active ? "font-bold" : "text-white/70"}`}>
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {MOBILE_FLOAT.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/business" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className="group relative flex min-h-11 min-w-11 items-center justify-center"
                >
                  <div
                    className={`nav3d-float flex h-11 w-11 items-center justify-center rounded-full ${
                      active ? "nav3d-float-active" : ""
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {active && <span className="nav3d-pip" />}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
