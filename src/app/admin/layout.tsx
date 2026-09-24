"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Package, AlertTriangle, Store, Users, Settings,
  Shield, ShieldCheck, Truck, BarChart3, ChevronLeft, Menu, X, Bell, Tag, Wallet, ClipboardList, AtSign
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import AdminLogin from "@/components/AdminLogin";
import AdminNotificationBell from "@/components/AdminNotificationBell";
import { Loader2 } from "lucide-react";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/applications", label: "Applications", icon: ClipboardList },
  { href: "/admin/orders", label: "Orders", icon: Package },
  { href: "/admin/merchants", label: "Merchants", icon: Store },
  { href: "/admin/business-names", label: "Name Changes", icon: Shield },
  { href: "/admin/morse-tag-requests", label: "Morse Tags", icon: AtSign },
  { href: "/admin/riders", label: "Riders", icon: Truck },
  { href: "/admin/disputes", label: "Disputes", icon: AlertTriangle },
  { href: "/admin/verifications", label: "Verifications", icon: ShieldCheck },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/settings", label: "Fees & Settings", icon: Settings },
  { href: "/admin/wallets", label: "Wallet Credits", icon: Wallet },
  { href: "/admin/payouts", label: "Payouts", icon: Wallet },
  { href: "/admin/promos", label: "Promo Codes", icon: Tag },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gate, setGate] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    // Require a fresh login per browser session. The session cookie is
    // session-only (cleared on browser close) so this returns 401 after restart.
    fetch("/api/admin/auth", { cache: "no-store" })
      .then((res) => setGate(res.ok ? "ok" : "denied"))
      .catch(() => setGate("denied"));
  }, []);

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
      <div className="min-h-screen bg-bg">
        <AdminLogin onAuthed={() => setGate("ok")} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
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
            <ThemeToggle variant="header" />
            <Link href="/" className="text-xs text-muted hover:text-fg transition hidden sm:inline">← App</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex gap-6">
          {/* Sidebar — desktop */}
          <nav className="hidden md:block w-56 shrink-0">
            <div className="sticky top-20 space-y-1">
              {NAV.map((n) => {
                const Icon = n.icon;
                const active = pathname === n.href || (n.href !== "/admin" && pathname.startsWith(n.href));
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      active ? "bg-go/15 text-go shadow-sm" : "text-muted hover:bg-elevated hover:text-fg"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {n.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-8 rounded-xl border border-border bg-surface p-3">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">GoDoor Admin</p>
              <p className="text-[10px] text-dim mt-1">v1.0 · ZentechX</p>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="text-[10px] text-success font-medium">System online</span>
              </div>
            </div>
          </nav>

          {/* Sidebar — mobile overlay */}
          {sidebarOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
              <nav className="fixed inset-y-0 left-0 z-50 w-64 bg-bg border-r border-border p-4 md:hidden overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                  <Logo size="sm" />
                  <button type="button" onClick={() => setSidebarOpen(false)} className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg"><X className="h-5 w-5" /></button>
                </div>
                <div className="space-y-1">
                  {NAV.map((n) => {
                    const Icon = n.icon;
                    const active = pathname === n.href || (n.href !== "/admin" && pathname.startsWith(n.href));
                    return (
                      <Link key={n.href} href={n.href} onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-go/15 text-go" : "text-muted hover:bg-elevated"}`}>
                        <Icon className="h-4 w-4" />{n.label}
                      </Link>
                    );
                  })}
                </div>
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
