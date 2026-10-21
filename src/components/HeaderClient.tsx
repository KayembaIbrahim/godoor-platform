"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, Wallet } from "lucide-react";
import { Logo } from "@/components/Logo";
import { HeaderAuth } from "@/components/HeaderAuth";
import { NotificationBell } from "@/components/NotificationBell";
import { BuildBadge } from "@/components/BuildBadge";
import { useHydrated } from "@/lib/use-hydrated";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSession, roleHomePath } from "@/lib/session-store";
import { useCart } from "@/lib/cart-store";

const NAV_LINKS = [
  { label: "Browse", href: "/app" },
  { label: "GoBoda", href: "/ride" },
  { label: "How it works", href: "/how-it-works" },
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
  { label: "Earnings", href: "/rider/earnings" },
  { label: "History", href: "/rider/history" },
];

/**
 * Routes that own their entire header row and must not be stacked under this
 * one.
 *
 * The customer home renders its own single row — logo, location pill, search,
 * bell, avatar — per the hybrid-theme brief. With this bar also present the
 * page opened with two headers and a duplicated logo, which is what made the
 * customer home read as "broken UI" while each piece was individually fine.
 *
 * A path PREFIX list, so `/app` also covers `/app/merchant/[id]` and friends —
 * those are still inside the customer experience. Reversible by removing one
 * string.
 */
const SELF_HEADED_ROUTES = ["/app"];

export function HeaderClient() {
  const { onboarded, role } = useSession();
  const pathname = usePathname();

  // `usePathname` returns null on the very first render during hydration on
  // some navigations. Rendering nothing for that frame is correct — a second
  // header appearing and vanishing is worse than a one-frame gap — and the
  // next render paints it.
  const ownsItsHeader = SELF_HEADED_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /* The session lives in localStorage, so the server has no idea whether
     anyone is signed in — it always renders the signed-out header. Zustand
     rehydrates synchronously, so the client would render the signed-in nav
     (and a different logo link) on its very first render, and React would
     throw hydration error #418 and throw the whole server-rendered page away.

     `signedIn` stays false until React has hydrated, which makes the first
     client render identical to the server's. The layout effect behind
     `useHydrated` flips it before the browser paints, so the real nav appears
     without a flash. */
  const hydrated = useHydrated();

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

  if (ownsItsHeader) return null;

  const dashboardHref = roleHomePath(role);
  /* `hydrated ? onboarded : false` — NOT `hydrated && onboarded`.
     Zustand's `persist` rehydrates synchronously from localStorage, so
     `onboarded` is already `true` on the client's very first render.
     `hydrated && onboarded` would therefore be `true` on the client and
     `false` on the server, and React would throw #418 and discard the
     server-rendered page. Gating on `hydrated` alone keeps the first client
     render identical to the server's, and the real value flows in once the
     layout effect flips `hydrated`. */
  const signedIn = hydrated ? onboarded : false;
  const isBusiness = signedIn && role === "business";
  const isRider = signedIn && role === "rider";
  const isCustomer = !signedIn || role === "customer";

  return (
    <header
      className={`nav-glass sticky top-0 z-40 border-b transition-all duration-300 ${
        scrolled ? "nav-glass-raised border-border" : "border-transparent"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link
            href={signedIn ? dashboardHref : "/"}
            className="group flex min-h-11 items-center gap-2 pr-2 transition-transform active:scale-95"
            title={signedIn ? "Go to my dashboard" : "GoDoor home"}
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
                      aria-current={active ? "page" : undefined}
                      className={`nav-pill ${active ? "nav-pill-active" : "nav-pill-idle"}`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
                {!signedIn && (
                  <>
                    <Link href="/partner?role=business" className="nav-pill nav-pill-idle">
                      For Business
                    </Link>
                    <Link href="/partner?role=rider" className="nav-pill nav-pill-idle">
                      For Riders
                    </Link>
                  </>
                )}
              </>
            ) : isBusiness ? (
              <>
                {BUSINESS_LINKS.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`nav-pill ${active ? "nav-pill-active" : "nav-pill-idle"}`}
                    >{link.label}</Link>
                  );
                })}
              </>
            ) : isRider ? (
              <>
                {RIDER_LINKS.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`nav-pill ${active ? "nav-pill-active" : "nav-pill-idle"}`}
                    >{link.label}</Link>
                  );
                })}
              </>
            ) : null}
          </nav>
        </div>
        {/* The icon cluster — uniform 40x40 hit areas with breathing room.

            The profile (avatar) is FIRST, so it is the first thing the eye
            finds and the one control the user reaches for most. It used to sit
            last, on the far right next to the hamburger, where it was the
            easiest control in the row to miss.

            Every control here is a uniform 40x40 hit area — the wallet and
            hamburger buttons used to be 32px while the bell, theme toggle and
            avatar were 36-40px, and a ragged cluster reads as "crammed" no
            matter how the gap is tuned. */}
        <div className="flex items-center gap-2.5 sm:gap-3 lg:gap-4">
          <HeaderAuth compact />
          <Link
            href="/wallet"
            className="tap-44 relative grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-navy transition hover:bg-navy hover:text-white active:scale-95 shadow-sm hover:shadow-lg ring-1 ring-border/50"
            aria-label="GoDoor Wallet"
            title="GoDoor Wallet"
          >
            <Wallet className="h-4 w-4" />
          </Link>
          <BuildBadge />
          <NotificationBell />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="tap-44 grid h-10 w-10 place-items-center rounded-full border border-border bg-surface text-navy transition-all hover:bg-navy hover:text-white active:scale-95 shadow-sm hover:shadow-lg ring-1 ring-border/50 lg:hidden"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="nav-glass border-t border-border lg:hidden">
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
            {isCustomer && (
              <>
                {NAV_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-elevated transition">{link.label}</Link>
                ))}
                {/* The dashboard CTA used to point at /app, which is the same
                    page as "Browse". These are the destinations a signed-in
                    customer actually opens from here. */}
                {signedIn && (
                  <>
                    <Link href="/orders" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-elevated transition">My orders</Link>
                    <Link href="/cart" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-elevated transition">Cart</Link>
                    <Link href="/wallet" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-elevated transition">Wallet</Link>
                    <Link href="/account" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-fg hover:bg-elevated transition">Account</Link>
                  </>
                )}
              </>
            )}
            {isBusiness && BUSINESS_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition">{link.label}</Link>
            ))}
            {isRider && RIDER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition">{link.label}</Link>
            ))}
            {!signedIn ? (
              <>
                <Link href="/partner?role=business" onClick={() => setMenuOpen(false)} className="rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 transition">Register your shop</Link>
                <Link href="/partner?role=rider" onClick={() => setMenuOpen(false)} className="rounded-xl bg-success/10 px-3 py-2.5 text-sm font-semibold text-success hover:bg-success/15 transition">Become a rider</Link>
                <Link href="/app" onClick={() => setMenuOpen(false)} className="rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-muted hover:bg-elevated hover:text-fg transition">Browse merchants</Link>
              </>
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