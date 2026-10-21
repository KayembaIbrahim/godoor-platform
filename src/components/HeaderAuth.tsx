"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { User, LogOut, Package, ShieldCheck, ChevronDown, ShoppingBag, ArrowRight, Mail, Lock, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { useSession, roleHomePath } from "@/lib/session-store";
import { useAuthModal, type AuthMode } from "@/lib/auth-modal-store";
import { useHydrated } from "@/lib/use-hydrated";
import { Logo } from "@/components/Logo";

/**
 * Sign-in is a single step: email + password.
 *
 * The role used to be picked first and passed into signIn as an override,
 * which let any account sign in as any role. The server already knows each
 * account's role, so we read it from the verified account and route on that
 * (see `roleHomePath`). Business and rider accounts are approved by GoDoor,
 * so sign-up creates a customer account and points applicants at /partner.
 */
function AuthModal({ open, onClose, startMode }: { open: boolean; onClose: () => void; startMode: AuthMode }) {
  const { signIn, signUp } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  useEffect(() => {
    // The requested mode wins, so "Create account" from the hero opens the
    // sign-up form directly instead of making the visitor press "Sign in" and
    // then find the toggle. A tab switch inside the dialog is unaffected.
    if (open) { setIsLogin(startMode !== "signup"); setEmail(""); setPassword(""); setName(""); setError(""); setSuccess(""); setLoading(false); setCooldown(0); }
  }, [open, startMode]);

  if (!open || !mounted) return null;

  const handleAuth = async () => {
    if (!email || !password || cooldown > 0) return;
    setError(""); setSuccess(""); setLoading(true);

    if (isLogin) {
      const res = await signIn(email, password);
      if (res.error) {
        setLoading(false);
        if (res.hint === "rate_limited") { setCooldown(60); setError("Too many attempts. Waiting 60 seconds..."); }
        // Do NOT switch to sign-up here. Supabase answers "Invalid login
        // credentials" for BOTH a wrong password AND an email that was never
        // registered, so flipping the form told every existing customer who
        // mistyped a password that they had "no account" — and then tried to
        // create a duplicate. Stay on the login form and say nothing that
        // implies the account is missing.
        else if (res.hint === "wrong_credentials") { setError("Wrong email or password. Check both and try again."); }
        else setError(res.error);
        return;
      }
      setLoading(false);
      onClose();
      // Role comes from the account, never from the form.
      window.location.href = roleHomePath(res.role ?? null);
      return;
    }

    if (!name.trim() || name.trim().length < 2) { setError("Enter your name."); setLoading(false); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); return; }
    const res = await signUp(email, password, name.trim(), "customer");
    if (res.error) {
      setLoading(false);
      if (res.hint === "rate_limited") { setCooldown(60); setError("Too many attempts. Waiting 60 seconds..."); }
      else if (res.hint === "already_registered") { setError("Account exists. Switching to sign in..."); setIsLogin(true); }
      else if (res.hint === "not_confirmed") { setSuccess("Account created! Check your email, or try signing in."); setIsLogin(true); }
      else setError(res.error);
      return;
    }
    setLoading(false);
    onClose();
    window.location.href = roleHomePath("customer");
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-y-auto rounded-3xl bg-bg p-5 shadow-2xl ring-1 ring-border animate-in fade-in zoom-in-95 duration-200" style={{ maxHeight: "min(80dvh, 560px)" }}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition" aria-label="Close">
          <span className="text-lg">×</span>
        </button>
        <div className="mb-4 flex items-center gap-3"><Logo size="sm" /></div>

        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
            {isLogin ? <User className="h-5 w-5 text-go" /> : <ShoppingBag className="h-5 w-5 text-go" />}
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">{isLogin ? "Welcome back" : "Create account"}</h2>
            <p className="text-xs text-muted">{isLogin ? "Sign in to your GoDoor account" : "Ordering, delivered"}</p>
          </div>
        </div>

        <div className="space-y-3">
          {!isLogin && (
            <div>
              <label className="text-xs text-muted">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}
        {success && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-success/10 px-3 py-2">
            <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            <p className="text-xs text-success">{success}</p>
          </div>
        )}

        <button type="button" disabled={loading || cooldown > 0} onClick={handleAuth}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 transition disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {cooldown > 0 ? `Wait ${cooldown}s` : isLogin ? "Sign in" : "Create account"}
        </button>

        <div className="mt-3 text-center">
          <button type="button" onClick={() => { setIsLogin(!isLogin); setError(""); setSuccess(""); }} className="text-xs text-dim underline decoration-dim/50 underline-offset-2 transition hover:text-go hover:decoration-go/60">
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>

        <p className="mt-4 rounded-xl bg-primary/10 px-3 py-2.5 text-xs text-primary leading-relaxed">
          Want to sell on GoDoor or deliver orders?{" "}
          <Link href="/partner" onClick={onClose} className="font-semibold underline">Apply to join.</Link>
        </p>
      </div>
    </div>,
    document.body
  );
}


/**
 * @param compact  Render just the avatar disc.
 *
 * The customer home header is a single tight row — logo, location pill, then
 * icons — and there is no room for a display name, a role chevron and a
 * dropdown caret beside two other controls on a 360px phone. `compact` drops
 * those and keeps the whole account menu, so it is the same control with less
 * furniture rather than a second avatar with different behaviour.
 */
export function HeaderAuth({ compact = false }: { compact?: boolean }) {
  const { onboarded, role, profile, supabaseUser, signOut } = useSession();
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
  // The dialog is a page-wide singleton (see `auth-modal-store`), so the hero
  // can ask for "Create account" and open THIS form rather than duplicating it.
  const authMode = useAuthModal((s) => s.mode);
  const openAuth = useAuthModal((s) => s.open);
  const closeAuth = useAuthModal((s) => s.close);
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
    <>
      <button type="button" onClick={() => openAuth("login")}
        className="flex min-h-11 items-center gap-1.5 rounded-full bg-gradient-to-r from-go to-go-2 px-4 py-2.5 text-xs font-semibold text-white transition hover:from-go-2 hover:to-go active:scale-[0.97] shadow-lg hover:shadow-xl">
        <User aria-hidden className="h-3.5 w-3.5" />Sign in
      </button>
      <AuthModal
        open={authMode !== null}
        startMode={(authMode ?? "login") as AuthMode}
        onClose={closeAuth}
      />
    </>
  );
}
