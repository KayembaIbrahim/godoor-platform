"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, LogOut, Package, ShieldCheck, ChevronDown } from "lucide-react";
import { useSession, roleHomePath } from "@/lib/session-store";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Sign-in happens on its own page (`/signin`), not in a popup.
 *
 * The old floating dialog had to be mounted inside `HeaderAuth`, which meant
 * only the header button could reach it, and the hero had to drive a page-wide
 * zustand singleton to open it. A dedicated page removes that indirection:
 * every entry point is a plain link, the form has room to breathe on a phone,
 * and a visitor can bookmark or share the sign-in URL.
 *
 * The role used to be picked first and passed into signIn as an override,
 * which let any account sign in as any role. The server already knows each
 * account's role, so we read it from the verified account and route on that
 * (see `roleHomePath`). Business and rider accounts are approved by GoDoor,
 * so sign-up creates a customer account and points applicants at /partner.
 */
export function HeaderAuth({ compact = false }: { compact?: boolean }) {
  const { onboarded, role, profile, supabaseUser, signOut } = useSession();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  /* The session lives in localStorage, so the server cannot know whether
     anyone is signed in — it always renders the signed-out control. Zustand
     rehydrates synchronously, so the client would render the avatar on its
     FIRST render and the two trees would disagree, throwing hydration error
     #418 and making React discard the whole server-rendered page.

     Until React has hydrated we therefore render exactly what the server
     rendered; the layout effect in `useHydrated` flips this before the
     browser paints, so a signed-in user sees their avatar immediately and
     never sees a flash of the "Sign in" button. */
  const hydrated = useHydrated();
  /* `hydrated ? onboarded : false` — NOT `hydrated && onboarded`.
     The session store rehydrates synchronously from localStorage, so
     `onboarded` is already `true` on the client's first render. `&&` would
     let that leak into the first render, the trees would disagree, and React
     would discard the whole server-rendered page (#418). */
  const showAccount = hydrated ? onboarded : false;
  const dropRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler, { passive: true });
    return () => document.removeEventListener("pointerdown", handler);
  }, [menuOpen]);

  const handleSignOut = async () => {
    await signOut();
    setMenuOpen(false);
    window.location.href = "/";
  };

  if (showAccount) {
    const initial = (profile.name || profile.email || "U").charAt(0).toUpperCase();
    const displayName = profile.name || profile.email || "User";
    const displayEmail = supabaseUser?.email || profile.email || "";
    const roleLabel = role === "business" ? "Business" : role === "rider" ? "Rider" : "Customer";
    const roleLabelColor = role === "business" ? "text-primary" : role === "rider" ? "text-primary" : "text-go";

    // All roles go to /account for profile
    const profileHref = "/account";
    const dashboardHref = roleHomePath(role);

    return (
      <div className="relative" ref={dropRef}>
        {/* Profile button — use pointerup for reliable mobile tap */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((p) => !p);
          }}
          className={`flex items-center gap-2 rounded-full border border-border bg-surface/60 transition-all hover:bg-elevated active:scale-95 shadow-lg hover:shadow-xl ring-1 ring-border/50 hover:ring-go/30 ${compact ? "h-10 w-10 justify-center p-0.5" : "py-1 pl-1 pr-2.5"}`}
          aria-label="Account menu"
          aria-expanded={menuOpen}
        >
          <div className={`relative grid place-items-center overflow-hidden rounded-full bg-gradient-to-br from-go to-go-2 ring-2 ring-go/30 shadow-inner ${compact ? "h-full w-full" : "h-7 w-7"}`}>
            {(profile as any).avatarUrl ? (
              <img
                src={(profile as any).avatarUrl}
                alt=""
                className="h-full w-full object-cover rounded-full"
              />
            ) : (
              <span className="text-xs font-bold text-white drop-shadow-md">{initial}</span>
            )}
            {/* A lit rim across the top of the disc — the highlight that makes
                the avatar read as a lit sphere rather than a flat cut-out. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-full bg-gradient-to-b from-white/35 to-transparent"
            />
          </div>
          {!compact && (
            <span className="hidden text-xs font-medium text-fg sm:inline">{displayName}</span>
          )}
          {!compact && (
            <ChevronDown
              className={`h-3 w-3 text-muted transition-all duration-300 ${menuOpen ? "rotate-180 text-go" : "hover:text-fg"}`}
            />
          )}
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-[60] mt-2 w-56 rounded-2xl border border-border bg-surface/95 backdrop-blur-md p-3 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-3 py-2 border-b border-border mb-3">
              <div className="flex items-center gap-3 mb-3">
                <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-go to-go-2 ring-2 ring-go/30 relative">
                  {(profile as any).avatarUrl ? (
                    <img src={(profile as any).avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-go to-go-2 rounded-full">
                      <span className="text-base font-bold text-white drop-shadow-sm">{initial}</span>
                    </div>
                  )}
                  {/* Premium status indicator for verified accounts */}
                  {role && role !== "customer" && (
                    <div className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-success border-3 border-surface">
                      <ShieldCheck className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{displayName}</p>
                  {displayEmail && <p className="text-[11px] text-muted truncate">{displayEmail}</p>}
                  <span className={`mt-1 inline-flex items-center gap-1 rounded-full bg-go/15 px-2 py-0.5 text-[9px] font-semibold capitalize ${roleLabelColor}`}>
                    <ShieldCheck className="h-2.5 w-2.5" />{roleLabel}
                  </span>
                </div>
              </div>
            </div>
            <Link href={dashboardHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-gradient-to-r hover:from-go/10 hover:to-go-2/10 hover:text-fg transition">
              <Package className="h-4 w-4" />Dashboard
            </Link>
            <Link href={profileHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-gradient-to-r hover:from-go/10 hover:to-go-2/10 hover:text-fg transition">
              <User className="h-4 w-4" />Profile & Settings
            </Link>
            {role === "business" && (
              <Link href="/verification" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-gradient-to-r hover:from-go/10 hover:to-go-2/10 hover:text-fg transition">
                <ShieldCheck className="h-4 w-4" />Verification
              </Link>
            )}
            {role === "rider" && (
              <Link href="/verification" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-gradient-to-r hover:from-go/10 hover:to-go-2/10 hover:text-fg transition">
                <ShieldCheck className="h-4 w-4" />Verification
              </Link>
            )}
            <button type="button" onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger hover:bg-danger/10 transition">
              <LogOut className="h-4 w-4" />Sign out
            </button>
            {/* Premium user info card */}
            <div className="mx-2 mt-3 rounded-xl border border-border bg-gradient-to-br from-surface via-surface/95 to-surface/80 p-3 shadow-lg">
              <div className="flex items-center gap-3 mb-3">
                <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-go to-go-2 ring-1 ring-go/30">
                  {(profile as any).avatarUrl ? (
                    <img src={(profile as any).avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold text-white drop-shadow-sm">{initial}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{displayName}</p>
                  {displayEmail && <p className="text-[11px] text-muted truncate">{displayEmail}</p>}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-muted">Account since</span>
                <span className="text-[10px] font-medium text-muted">
                  {(() => {
                    try {
                      const raw = localStorage.getItem("godoor-session");
                      if (!raw) return "N/A";
                      const parsed = JSON.parse(raw);
                      const created = parsed?.state?.profile?.createdAt || parsed?.state?.profile?.morseTag || "N/A";
                      return created !== "N/A" ? new Date(created).getFullYear() : "N/A";
                    } catch { return "N/A"; }
                  })()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => router.push("/signin")}
      className="flex min-h-11 items-center gap-1.5 rounded-full bg-gradient-to-r from-go to-go-2 px-4 py-2.5 text-xs font-semibold text-white transition hover:from-go-2 hover:to-go active:scale-[0.97] shadow-lg hover:shadow-xl"
    >
      <User aria-hidden className="h-3.5 w-3.5" />Sign in
    </button>
  );
}
