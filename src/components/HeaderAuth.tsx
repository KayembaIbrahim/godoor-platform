"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { User, LogOut, Package, ShieldCheck, ChevronDown, ShoppingBag, Store, Truck, ArrowRight, ArrowLeft, Mail, Lock, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { useSession, type Role } from "@/lib/session-store";
import { Logo } from "@/components/Logo";

const ROLES: { id: Role; label: string; desc: string; icon: typeof Store; color: string }[] = [
  { id: "customer", label: "Customer", desc: "Order food, pharmacy, parcels", icon: ShoppingBag, color: "text-go" },
  { id: "business", label: "Business", desc: "Sell on GoDoor, receive orders", icon: Store, color: "text-primary" },
  { id: "rider", label: "Rider", desc: "Deliver orders, earn money", icon: Truck, color: "text-[#f97316]" },
];

function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn, signUp } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [step, setStep] = useState<"role" | "auth">("role");
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  useEffect(() => {
    if (open) { setStep("role"); setSelectedRole(null); setIsLogin(true); setEmail(""); setPassword(""); setName(""); setError(""); setSuccess(""); setLoading(false); setCooldown(0); }
  }, [open]);

  if (!open || !mounted) return null;

  const handleAuth = async () => {
    if (!selectedRole || !email || !password || cooldown > 0) return;
    setError(""); setSuccess(""); setLoading(true);
    if (!isLogin && selectedRole !== "customer") {
      setError("Business & rider accounts are created by GoDoor. Submit an application instead.");
      setLoading(false);
      return;
    }
    if (isLogin) {
      const res = await signIn(email, password, selectedRole);
      if (res.error) {
        setLoading(false);
        if (res.hint === "rate_limited") { setCooldown(60); setError("Too many attempts. Waiting 60 seconds..."); }
        else if (res.hint === "wrong_credentials") { setError("Wrong email or password. Want to create an account?"); setIsLogin(false); }
        else setError(res.error);
        return;
      }
    } else {
      if (!name.trim() || name.trim().length < 2) { setError("Enter your name."); setLoading(false); return; }
      if (password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); return; }
      const res = await signUp(email, password, name.trim(), selectedRole);
      if (res.error) {
        setLoading(false);
        if (res.hint === "rate_limited") { setCooldown(60); setError("Too many attempts. Waiting 60 seconds..."); }
        else if (res.hint === "already_registered") { setError("Account exists. Switching to sign in..."); setIsLogin(true); }
        else if (res.hint === "not_confirmed") { setSuccess("Account created! Check your email, or try signing in."); setIsLogin(true); }
        else setError(res.error);
        return;
      }
      setSuccess("Account created!");
    }
    setLoading(false);
    onClose();
    const dest = selectedRole === "business" ? "/business" : selectedRole === "rider" ? "/rider" : "/app";
    window.location.href = dest;
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-y-auto rounded-3xl bg-bg p-5 shadow-2xl ring-1 ring-border animate-in fade-in zoom-in-95 duration-200" style={{ maxHeight: "min(80dvh, 560px)" }}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition" aria-label="Close">
          <span className="text-lg">×</span>
        </button>
        <div className="mb-4 flex items-center gap-3"><Logo size="sm" /></div>

        {step === "role" && (
          <>
            <h2 className="font-display text-xl font-semibold">Sign in to GoDoor</h2>
            <p className="mt-1 text-sm text-muted">Choose your account type</p>
            <div className="mt-4 space-y-2">
              {ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <button key={r.id} type="button" onClick={() => { setSelectedRole(r.id); setStep("auth"); }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 text-left transition hover:border-go/40 hover:bg-elevated active:scale-[0.98]">
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-go/10"><Icon className={`h-5 w-5 ${r.color}`} /></div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-fg">{r.label}</p>
                      <p className="text-xs text-muted">{r.desc}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted" />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "auth" && (
          <>
            <div className="mb-4 flex items-center gap-3">
              {selectedRole && (() => { const r = ROLES.find((x) => x.id === selectedRole)!; const I = r.icon; return <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10"><I className={`h-5 w-5 ${r.color}`} /></div>; })()}
              <div>
                <h2 className="font-display text-lg font-semibold">{isLogin ? "Welcome back" : "Create account"}</h2>
                <p className="text-xs text-muted">{selectedRole ? ROLES.find((r) => r.id === selectedRole)?.label : ""}</p>
              </div>
            </div>

            <div className="space-y-3">
              {!isLogin && selectedRole !== "customer" && (
                <p className="rounded-xl bg-primary/10 px-3 py-2.5 text-xs text-primary leading-relaxed">
                  Business & rider accounts are created by the GoDoor team.{" "}
                  <Link href="/partner?role=business" onClick={onClose} className="font-semibold underline">Apply to join instead.</Link>
                </p>
              )}
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

            <div className="mt-3 flex items-center justify-between">
              <button type="button" onClick={() => { setIsLogin(!isLogin); setError(""); setSuccess(""); }} className="text-xs text-dim underline decoration-dim/50 underline-offset-2 transition hover:text-go hover:decoration-go/60">
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
              <button type="button" onClick={() => { setStep("role"); setError(""); setSuccess(""); }} className="text-xs text-dim hover:text-fg transition flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export function HeaderAuth() {
  const { onboarded, role, profile, supabaseUser, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  if (onboarded) {
    const initial = (profile.name || profile.email || "U").charAt(0).toUpperCase();
    const displayName = profile.name || profile.email || "User";
    const displayEmail = supabaseUser?.email || profile.email || "";
    const roleLabel = role === "business" ? "Business" : role === "rider" ? "Rider" : "Customer";
    const roleLabelColor = role === "business" ? "text-primary" : role === "rider" ? "text-[#f97316]" : "text-go";

    // All roles go to /account for profile
    const profileHref = "/account";
    const dashboardHref = role === "business" ? "/business" : role === "rider" ? "/rider" : "/app";

    return (
      <div className="relative" ref={dropRef}>
        {/* Profile button — use pointerup for reliable mobile tap */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((p) => !p); }}
          className="flex items-center gap-2 rounded-full border border-border bg-surface/60 pl-1 pr-2.5 py-1 transition hover:bg-elevated active:scale-95"
          aria-label="Account menu"
          aria-expanded={menuOpen}
        >
          <div className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-go/20 ring-1 ring-go/30">
            {(profile as any).avatarUrl ? (
              <img src={(profile as any).avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-go">{initial}</span>
            )}
          </div>
          <span className="hidden text-xs font-medium text-fg sm:inline">{displayName}</span>
          <ChevronDown className={`h-3 w-3 text-muted transition-transform ${menuOpen ? "rotate-180" : ""}`} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-[60] mt-2 w-56 rounded-2xl border border-border bg-surface p-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-sm font-semibold text-fg truncate">{displayName}</p>
              {displayEmail && <p className="text-[10px] text-muted truncate">{displayEmail}</p>}
              <span className={`mt-1 inline-flex items-center gap-1 rounded-full bg-go/15 px-2 py-0.5 text-[9px] font-semibold capitalize ${roleLabelColor}`}>
                <ShieldCheck className="h-2.5 w-2.5" />{roleLabel}
              </span>
            </div>
            <Link href={dashboardHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg transition">
              <Package className="h-4 w-4" />Dashboard
            </Link>
            <Link href={profileHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg transition">
              <User className="h-4 w-4" />Profile & Settings
            </Link>
            {role === "business" && (
              <Link href="/verification" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg transition">
                <ShieldCheck className="h-4 w-4" />Verification
              </Link>
            )}
            {role === "rider" && (
              <Link href="/verification" onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg transition">
                <ShieldCheck className="h-4 w-4" />Verification
              </Link>
            )}
            <Link href="/tutorial" onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg transition">
              <Package className="h-4 w-4" />How to use GoDoor
            </Link>
            <Link href="/help" onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-elevated hover:text-fg transition">
              <ShieldCheck className="h-4 w-4" />Help Centre
            </Link>
            <button type="button" onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger hover:bg-danger/10 transition">
              <LogOut className="h-4 w-4" />Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full bg-go px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-go-2 active:scale-[0.97]">
        <User className="h-3.5 w-3.5" />Sign in
      </button>
      <AuthModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
