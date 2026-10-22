"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Package, AlertTriangle, Store, Users, Settings,
  Shield, ShieldCheck, Truck, BarChart3, ChevronLeft, Menu, X, Bell, Tag, Wallet, ClipboardList, AtSign,
  BanknoteArrowDown, Download, Clock, ArrowUpRight, Megaphone, PanelTop, ArrowLeftRight, CalendarCheck,
  Image, Sunrise, KeyRound, LifeBuoy, ChevronDown, Search, Activity, Zap, Percent, Sparkles,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import AdminLogin from "@/components/AdminLogin";
import AdminNotificationBell from "@/components/AdminNotificationBell";
import { Loader2 } from "lucide-react";

/**
 * The admin portal shell.
 *
 * ── Why the navigation is grouped ──────────────────────────────────────────
 * The portal grew to 27 destinations listed as one flat column. At that
 * length the list is a wall: the operator has to read past the things they do
 * not care about to reach the thing they do, and a group label ("Money",
 * "People") tells them where to look before they have read a single item.
 *
 * The sections below are the ones an operator actually thinks in:
 *
 *   Overview   — how is the platform doing right now
 *   Operations — the day-to-day flow of orders and complaints
 *   People     — riders, merchants, customers and their verification
 *   Money      — balances, payouts and withdrawals
 *   Growth     — campaigns, promos and the surfaces they decorate
 *   Platform   — settings, releases and the tools that keep accounts safe
 *
 * ── Why there is a search box ──────────────────────────────────────────────
 * Grouping helps you find a section. Searching finds the exact page in one
 * keystroke, which matters most for the items buried two levels deep.
 */

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { title: string; icon: React.ComponentType<{ className?: string }>; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    icon: Activity,
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Operations",
    icon: Package,
    items: [
      { href: "/admin/orders", label: "Orders", icon: Package },
      { href: "/admin/bookings", label: "Table Booking", icon: CalendarCheck },
      { href: "/admin/shopping-lists", label: "Shopping Lists", icon: ClipboardList },
      { href: "/admin/disputes", label: "Disputes", icon: AlertTriangle },
      { href: "/admin/stopovers", label: "Fares & Waiting", icon: Clock },
    ],
  },
  {
    title: "People",
    icon: Users,
    items: [
      { href: "/admin/applications", label: "Applications", icon: ClipboardList },
      { href: "/admin/riders", label: "Riders", icon: Truck },
      { href: "/admin/merchants", label: "Merchants", icon: Store },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/verifications", label: "Verifications", icon: ShieldCheck },
      { href: "/admin/business-names", label: "Name Changes", icon: Shield },
      { href: "/admin/morse-tag-requests", label: "Morse Tags", icon: AtSign },
    ],
  },
  {
    title: "Money",
    icon: Wallet,
    items: [
      { href: "/admin/wallets", label: "Wallet Credits", icon: Wallet },
      { href: "/admin/payouts", label: "Payouts", icon: BanknoteArrowDown },
      { href: "/admin/withdrawals", label: "Withdrawals", icon: ArrowUpRight },
      {href: "/admin/transfers", label: "Transfers", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Growth",
    icon: Sparkles,
    items: [
      { href: "/admin/promos", label: "Promo Codes", icon: Tag },
      { href: "/admin/campaigns", label: "Flyer Popups", icon: Megaphone },
      { href: "/admin/hero-banner", label: "Sponsored Banner", icon: PanelTop },
      { href: "/admin/welcome-bg", label: "Welcome Background", icon: Image },
      { href: "/admin/greeting-bg", label: "Greeting Card", icon: Sunrise },
    ],
  },
  {
    title: "Platform",
    icon: Settings,
    items: [
      { href: "/admin/settings", label: "Fees & Settings", icon: Percent },
      { href: "/admin/password-resets", label: "Password Resets", icon: KeyRound },
      { href: "/admin/support", label: "Support", icon: LifeBuoy },
      { href: "/admin/apk", label: "App Release", icon: Download },
    ],
  },
];

/** Flat list, used by the search box and the mobile drawer. */
const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gate, setGate] = useState<"loading" | "ok" | "denied">("loading");
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  useEffect(() => {
    // Require a fresh login per browser session. The session cookie is
    // session-only (cleared on browser close) so this returns 401 after restart.
    fetch("/api/admin/auth", { cache: "no-store" })
      .then((res) => setGate(res.ok ? "ok" : "denied"))
      .catch(() => setGate("denied"));
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  /**
   * The group that owns the current page starts open, and the one before it
   * too, so the operator always sees where they are. Everything else is
   * collapsed until asked for — a 27-item wall becomes a 6-item list.
   */
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((g) =>
      g.items.some((i) => pathname === i.href || (i.href !== "/admin" && pathname.startsWith(i.href))),
    );
    if (!activeGroup) return;
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.add(activeGroup.title);
      const idx = NAV_GROUPS.findIndex((g) => g.title === activeGroup.title);
      if (idx > 0) next.add(NAV_GROUPS[idx - 1].title);
      return [...next];
    });
  }, [pathname]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ALL_ITEMS.filter(
      (i) => i.label.toLowerCase().includes(q) || i.href.toLowerCase().includes(q),
    );
  }, [query]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/admin" && pathname.startsWith(href));

  if (gate === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-go" />
          <span className="text-xs">Checking session…</span>
        </div>
      </div>
    );
  }

  if (gate === "denied") {
    return (
      <div className="min-h-screen bg-bg" data-admin-portal>
        <AdminLogin onAuthed={() => setGate("ok")} />
      </div>
    );
  }

  const navTree = (
    <div className="space-y-0.5">
      {NAV_GROUPS.map((group) => {
        const GroupIcon = group.icon;
        const open = openGroups.includes(group.title);
        const groupHasActive = group.items.some((i) => isActive(i.href));
        return (
          <div key={group.title}>
            <button
              type="button"
              onClick={() =>
                setOpenGroups((prev) =>
                  prev.includes(group.title)
                    ? prev.filter((t) => t !== group.title)
                    : [...prev, group.title],
                )
              }
              aria-expanded={open}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition ${
                groupHasActive ? "text-go" : "text-dim hover:text-muted"
              }`}
            >
              <GroupIcon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{group.title}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="mb-1 ml-3 space-y-0.5 border-l border-border pl-2">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all ${
                        active
                          ? "bg-go/15 text-go shadow-sm"
                          : "text-muted hover:bg-elevated hover:text-fg"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const footerCard = (
    <div className="mt-6 rounded-xl border border-border bg-surface p-3">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">GoDoor Admin</p>
      <p className="mt-1 text-[10px] text-dim">v1.0 · ZentechX</p>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        <span className="text-[10px] font-medium text-success">System online</span>
      </div>
    </div>
  );

  return (
    /* `data-admin-portal` is read by <FlyerPopup />. The portal is reached via
       the secret path, which the browser sees as /{secret}/… — not /admin — so
       the URL alone cannot tell the two apart. A DOM marker can, and it keeps
       an admin from being interrupted by the very campaign they are editing. */
    <div className="min-h-screen bg-bg" data-admin-portal>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg">
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link href="/admin" className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg bg-go/15">
                <Shield className="h-4 w-4 text-go" />
              </div>
              <Logo size="sm" />
            </Link>
            <span className="rounded-full bg-go/15 px-2.5 py-0.5 text-[10px] font-bold text-go uppercase tracking-wider">Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <AdminNotificationBell />
            <ThemeToggle />
            <Link href="/" className="text-xs text-muted transition hover:text-fg hidden sm:inline">← App</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex gap-6">
          {/* Sidebar — desktop */}
          <nav className="hidden md:block w-60 shrink-0">
            <div className="sticky top-20 space-y-1">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a page…"
                  className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-xs outline-none transition placeholder:text-dim focus:border-go focus:ring-2 focus:ring-go/30"
                />
                {query.trim() && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                    {results.length === 0 ? (
                      <p className="px-3 py-3 text-center text-[11px] text-dim">No page matches “{query}”.</p>
                    ) : (
                      results.map((r) => {
                        const Icon = r.icon;
                        return (
                          <Link
                            key={r.href}
                            href={r.href}
                            onClick={() => setQuery("")}
                            className={`flex items-center gap-2.5 px-3 py-2 text-[13px] transition hover:bg-elevated ${
                              isActive(r.href) ? "bg-go/15 text-go" : "text-muted"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{r.label}</span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              {navTree}
              {footerCard}
            </div>
          </nav>

          {/* Sidebar — mobile overlay */}
          {sidebarOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
              <nav className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-border bg-bg p-4 md:hidden">
                <div className="mb-4 flex items-center justify-between">
                  <Logo size="sm" />
                  <button type="button" onClick={() => setSidebarOpen(false)} className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg"><X className="h-5 w-5" /></button>
                </div>
                {navTree}
                {footerCard}
              </nav>
            </>
          )}

          {/* Content */}
          <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
