"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { HeaderAuth } from "@/components/HeaderAuth";
import { NotificationBell } from "@/components/NotificationBell";
import { useSession, roleHomePath } from "@/lib/session-store";
import { useCart } from "@/lib/cart-store";

const NAV_LINKS = [
  { label: "Browse", href: "/app" },
  { label: "Ride", href: "/ride" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Tutorial", href: "/tutorial" },
  { label: "Help", href: "/help" },
];

const BUSINESS_LINKS = [
  { label: "Orders", href: "/business/orders" },
  { label: "Products", href: "/business/products" },
  { label: "Store", href: "/business/store" },
  { label: "Earnings", href: "/business/earnings" },
];

const RIDER_LINKS = [
  { label: "Available", href: "/rider" },
  { label: "Map", href: "/tracking" },
  { label: "Earnings", href: "/rider/earnings" },
];

export function HeaderClient() {
  const { onboarded, role } = useSession();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Business/rider should never retain a customer cart — clear it on role switch (lazy bug fix)
  useEffect(() => {
    if (onboarded && (role === "business" || role === "rider" || role === "admin")) {
      try {
        const count = useCart.getState().count();
        if (count > 0) useCart.getState().clear();
      } catch {}
    }
  }, [role, onboarded]);

  const dashboardHref = roleHomePath(role);
  const isBusiness = onboarded && role === "business";
  const isRider = onboarded && role === "rider";
  const isCustomer = !onboarded || role === "customer";

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        scrolled ? "shadow-card" : "shadow-none"
      } border-b bg-bg/80 backdrop-blur-xl ${scrolled ? "border-border" : "border-transparent"}`}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link
            href={onboarded ? dashboardHref : "/"}
            className="group flex items-center gap-2 transition-transform active:scale-95"
            title={onboarded ? "Go to my dashboard" : "GoDoor home"}
          >
            <Logo size="sm" />
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {isCustomer ? (
              <>
                {NAV_LINKS.map((link) => {
                  const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href.split("#")[0]));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        active ? "bg-go/10 text-go" : "text-muted hover:bg-elevated hover:text-fg"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
                {!onboarded && (
                  <>
                    <Link href="/partner?role=business" className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-elevated hover:text-fg transition">
                      For Business
                    </Link>
                    <Link href="/partner?role=rider" className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-elevated hover:text-fg transition">
                      For Riders
                    </Link>
                  </>
                )}
                {onboarded && (
                  <Link href={dashboardHref} className="rounded-full bg-go/10 px-3 py-1.5 text-xs font-semibold text-go hover:bg-go/15 transition">
                    Dashboard
                  </Link>
                )}
              </>
            ) : isBusiness ? (
              <>
                {BUSINESS_LINKS.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(link.href);
                  return (
                    <Link key={link.href} href={link.href} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${active ? "bg-primary/10 text-primary" : "text-muted hover:bg-elevated hover:text-fg"}`}>{link.label}</Link>
                  );
                })}
                <Link href={dashboardHref} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 transition">Business</Link>
              </>
            ) : isRider ? (
              <>
                {RIDER_LINKS.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(link.href);
                  return (
                    <Link key={link.href} href={link.href} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${active ? "bg-primary/10 text-primary" : "text-muted hover:bg-elevated hover:text-fg"}`}>{link.label}</Link>
                  );
                })}
                <Link href={dashboardHref} className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 transition">Rider</Link>
              </>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <HeaderAuth />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted transition hover:bg-elevated hover:text-fg lg:hidden"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-border bg-surface/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
            {isCustomer && NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-elevated transition">{link.label}</Link>
            ))}
            {isBusiness && BUSINESS_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition">{link.label}</Link>
            ))}
            {isRider && RIDER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition">{link.label}</Link>
            ))}
            {!onboarded ? (
              <>
                <Link href="/partner?role=business" onClick={() => setMenuOpen(false)} className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 transition">Register your shop</Link>
                <Link href="/partner?role=rider" onClick={() => setMenuOpen(false)} className="rounded-xl bg-success/10 px-3 py-2.5 text-sm font-semibold text-success hover:bg-success/15 transition">Become a rider</Link>
                <Link href="/app" onClick={() => setMenuOpen(false)} className="rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-muted hover:bg-elevated hover:text-fg transition">Browse merchants</Link>
              </>
            ) : isCustomer ? (
              <Link href={dashboardHref} onClick={() => setMenuOpen(false)} className="rounded-xl bg-go px-3 py-2.5 text-sm font-semibold text-white hover:bg-go-2 transition">Go to dashboard</Link>
            ) : isBusiness ? (
              <Link href={dashboardHref} onClick={() => setMenuOpen(false)} className="rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition">Business dashboard</Link>
            ) : isRider ? (
              <Link href={dashboardHref} onClick={() => setMenuOpen(false)} className="rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-2 transition">Rider dashboard</Link>
            ) : null}
          </nav>
        </div>
      )}
    </header>
  );
}