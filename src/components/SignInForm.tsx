"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { User, ShoppingBag, Mail, Lock, Loader2, AlertTriangle, CheckCircle, ArrowRight, KeyRound } from "lucide-react";
import { useSession, roleHomePath, type Role } from "@/lib/session-store";

/**
 * The single form on the welcome sign-in page.
 *
 * Login is email + password; create account adds a full name. Both tabs drive
 * the same session store, so on success the user lands wherever their real
 * role takes them (business → /business, rider → /rider, customer → /app).
 *
 * "Mode" is decided by the caller because "Sign in to finish checkout" and
 * "Create your free account" want opposite starting points. A tab switch inside
 * the form is unaffected — only the initial mode passed as a prop matters.
 */
export type SignInMode = "login" | "signup";

function resolveDestination(role: Role | null | undefined, next: string): string {
  // `next` lets a caller deep-link back after sign-in instead of always going to
  // the role dashboard; only absolute internal paths are honoured.
  if (next && /^[\/a-zA-Z0-9]/.test(next) && !next.startsWith("//")) return next;
  return roleHomePath(role);
}

export function SignInForm({ mode: initialMode = "login", next }: { mode?: SignInMode; next?: string }) {
  /**
   * The session store is deliberately NOT subscribed to here.
   *
   * `useSession()` subscribes the component to the whole store through
   * `useSyncExternalStore`. The store is persisted, so on the client it
   * rehydrates synchronously from localStorage: `getSnapshot()` then returns
   * the rehydrated state while `getServerSnapshot()` returns the initial
   * state. React sees the two disagree and forces a client-side re-render
   * (and warns about the mismatch in development).
   *
   * Nothing this form renders depends on the session, so the subscription buys
   * us nothing and only costs us a hydration mismatch. Instead the two
   * actions are read straight off the store when the form is submitted.
   */
  const [isLogin, setIsLogin] = useState(initialMode !== "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  // The requested mode wins, so "Create account" from the hero opens the
  // sign-up form directly instead of making the visitor press "Sign in" and
  // then find the toggle. A tab switch inside the form is unaffected.
  useEffect(() => {
    setIsLogin(initialMode !== "signup");
    setEmail(""); setPassword(""); setName(""); setError(""); setSuccess(""); setLoading(false); setCooldown(0);
  }, [initialMode]);

  const handleAuth = async () => {
    if (!email || !password || cooldown > 0) return;
    setError(""); setSuccess(""); setLoading(true);

    if (isLogin) {
      const { signIn } = useSession.getState();
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
      window.location.href = resolveDestination(res.role ?? null, next ?? "");
      return;
    }

    if (!name.trim() || name.trim().length < 2) { setError("Enter your name."); setLoading(false); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); return; }
    const { signUp } = useSession.getState();
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
    setSuccess("Account created successfully!");
    window.location.href = resolveDestination(null, next ?? "");
  };

  return (
    <div className="w-full max-w-md">
      {/* The form sits on a RAISED card: a real surface with its own border
          and a deep cast shadow, floating above the welcome artwork. Over a
          photograph a flat form is unreadable; a lifted panel gives the text
          a guaranteed surface and gives the page depth. */}
      <div className="rounded-3xl border border-border/80 bg-surface/85 p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.55),0_2px_8px_-2px_rgba(15,23,42,0.2)] backdrop-blur-xl sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
            {isLogin ? <User className="h-5 w-5 text-go" /> : <ShoppingBag className="h-5 w-5 text-go" />}
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">{isLogin ? "Welcome back" : "Create account"}</h1>
            <p className="text-sm text-muted">{isLogin ? "Sign in to your GoDoor account" : "Ordering, delivered"}</p>
          </div>
        </div>

        {/* The mode switch — TWO independent buttons, each with its own
            surface and its own lift. They used to be two halves of one
            segmented bar, which read as a single control you drag; they are
            two different destinations, so they get to look like two
            different buttons. */}
        <div className="mb-5 flex gap-2.5">
          <button
            type="button"
            onClick={() => setIsLogin(true)}
            className={`btn-3d flex-1 px-4 py-2.5 text-sm font-semibold transition ${
              isLogin
                ? "btn-3d-brand text-white"
                : "text-muted hover:text-fg"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setIsLogin(false)}
            className={`btn-3d flex-1 px-4 py-2.5 text-sm font-semibold transition ${
              !isLogin
                ? "btn-3d-brand text-white"
                : "text-muted hover:text-fg"
            }`}
          >
            Create account
          </button>
        </div>

        <div className="space-y-3">
          {!isLogin && (
            <div>
              <label className="text-xs text-muted">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe"
                className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2 transition" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2 transition" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2 transition" />
            </div>
            {isLogin && (
              /*
                GoDoor has no outbound mail provider configured, so the server
                cannot automatically send an email reset link right now — the
                request route calls Supabase's generateLink which will send via
                its SMTP when it is configured. For now this entry point points
                at the self-service email-reset flow, which asks for an email
                and issues a one-time reset code + link via the support desk.
              */
              <div className="mt-1.5 text-right">
                <Link
                  href="/forgot-password"
                  className="inline-flex items-center gap-1 text-[11px] text-dim underline decoration-dim/50 underline-offset-2 transition hover:text-go hover:decoration-go/60"
                >
                  <KeyRound className="h-3 w-3" /> Forgot your password?
                </Link>
              </div>
            )}
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
          className="btn-3d btn-3d-brand mt-4 flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:hover:translate-y-0">
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
          <Link href="/partner" className="font-semibold underline">Apply to join.</Link>
        </p>
      </div>
    </div>
  );
}
