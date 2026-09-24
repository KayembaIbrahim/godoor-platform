"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, Store, Truck, ArrowRight, ArrowLeft, X, ShieldCheck, Mail, Lock, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { MorseLogo } from "@/components/MorseLogo";
import { useSession, type Role } from "@/lib/session-store";
import { apiAuthHeaders } from "@/lib/db";
import { Logo } from "@/components/Logo";

export function useSignupPrompt() {
  const { onboarded } = useSession();
  const [open, setOpen] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const prompt = (currentUrl?: string) => {
    if (onboarded) return false;
    setReturnTo(currentUrl || window.location.pathname);
    setOpen(true);
    return true;
  };

  return { open, setOpen, returnTo, prompt, isGuest: !onboarded };
}

const ROLES: { id: Role; label: string; desc: string; icon: typeof Store; color: string }[] = [
  { id: "customer", label: "Shop on GoDoor", desc: "Order food, pharmacy, parcels", icon: ShoppingBag, color: "text-go" },
  { id: "business", label: "Register a business", desc: "List your shop on GoDoor", icon: Store, color: "text-primary-2" },
  { id: "rider", label: "Become a rider", desc: "Deliver orders, earn money", icon: Truck, color: "text-[#f97316]" },
];

export function SignupModal({
  open,
  onClose,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  returnTo: string | null;
}) {
  const router = useRouter();
  const { setRole, setProfile, completeOnboarding, signUp, signIn } = useSession();
  const [step, setStep] = useState<"role" | "auth">("role");
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [morseTag, setMorseTag] = useState("");
  const [morseTagConfirm, setMorseTagConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passOk = password.length >= 6;
  const nameOk = name.trim().length >= 2;
  const morseOk = /^[a-z0-9_]{3,32}$/i.test(morseTag.trim().replace(/^@/, ""));

  useEffect(() => {
    if (open) {
      setStep("role");
      setSelectedRole(null);
      setEmail("");
      setPassword("");
      setName("");
      setMorseTag("");
      setMorseTagConfirm("");
      setIsLogin(false);
      setError("");
      setSuccess("");
      setLoading(false);
      setCooldown(0);
    }
  }, [open]);

  // Cooldown timer for rate limits
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selectedRole || !emailOk) return;
    if (cooldown > 0) return;
    // Morse username is compulsory on GoDoor — every role must confirm their
    // Morse wallet handle (they have to sign up on Morse to top up using it).
    if (!isLogin && !morseOk) {
      setError("Add your Morse username to continue — you need it to confirm your Morse wallet.");
      return;
    }
    if (!isLogin && morseTagConfirm.trim().replace(/^@/, "").toLowerCase() !== morseTag.trim().replace(/^@/, "").toLowerCase()) {
      setError("Morse usernames must match — type the same tag twice.");
      setLoading(false);
      return;
    }
    setError("");
    setSuccess("");
    setLoading(true);

    if (isLogin) {
      const res = await signIn(email, password);
      if (res.error) {
        setLoading(false);
        if (res.hint === "rate_limited") {
          setCooldown(60);
          setError("Too many attempts. Waiting 60 seconds...");
        } else if (res.hint === "wrong_credentials") {
          // Offer to sign up instead
          setError("Wrong email or password. Want to create an account?");
          setIsLogin(false);
        } else {
          setError(res.error);
        }
        return;
      }
    } else {
      if (!nameOk || !passOk) { setLoading(false); return; }
      const res = await signUp(email, password, name.trim(), selectedRole);
      if (res.error) {
        setLoading(false);
        if (res.hint === "rate_limited") {
          setCooldown(60);
          setError("Too many attempts. Waiting 60 seconds...");
        } else if (res.hint === "already_registered") {
          // Auto sign-in happened in session-store, but if it didn't:
          setError("Account exists. Switching to sign in...");
          setIsLogin(true);
          setLoading(false);
          return;
        } else if (res.hint === "not_confirmed") {
          setSuccess("Account created! Check your email to confirm, or try signing in.");
          setIsLogin(true);
        } else {
          setError(res.error);
        }
        setLoading(false);
        return;
      } else {
        setSuccess("Account created successfully!");
      }
    }

    // Persist + validate the Morse username (unique per user). On any "taken"
    // response we keep the modal open so the user picks a different tag.
    if (morseOk) {
      const tagRes = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag: morseTag.trim() }),
      });
      const tagJson = await tagRes.json().catch(() => ({}));
      if (!tagRes.ok) {
        setLoading(false);
        setSuccess("");
        setError(tagJson?.error || "That morse tag could not be saved.");
        return;
      }
      setProfile({ morseTag: tagJson?.tag || morseTag.trim() });
    }

    setLoading(false);
    setSuccess("Welcome to GoDoor!");
    setTimeout(() => {
      onClose();
      const dest = selectedRole === "business" ? "/business" : selectedRole === "rider" ? "/rider" : "/app";
      router.push(selectedRole === "customer" && returnTo ? returnTo : dest);
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-y-auto rounded-3xl bg-bg p-5 shadow-2xl ring-1 ring-border animate-scale-in overscroll-contain" style={{ maxHeight: "min(85dvh, 600px)" }}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 flex items-center gap-3"><Logo size="sm" /></div>

        {step === "role" && (
          <>
            <h2 className="font-display text-xl font-semibold">Join GoDoor</h2>
            <p className="mt-1 text-sm text-muted">Pick your role — takes less than a minute.</p>
            <div className="mt-4 space-y-2">
              {ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <button key={r.id} type="button" onClick={() => { setSelectedRole(r.id); setStep("auth"); }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-primary/40 hover:bg-elevated active:scale-[0.98]">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-go/15 ring-1 ring-go/20"><Icon className={`h-5 w-5 ${r.color}`} /></span>
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{r.label}</p><p className="text-[11px] text-muted">{r.desc}</p></div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-dim" />
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-dim"><ShieldCheck className="h-3 w-3" />Secure email + password auth</p>
          </>
        )}

        {step === "auth" && (
          <>
            <h2 className="font-display text-xl font-semibold">{isLogin ? "Welcome back" : "Create account"}</h2>
            <p className="mt-1 text-sm text-muted">{isLogin ? "Sign in to continue" : `Signing up as ${selectedRole}`}</p>

            <div className="mt-4 space-y-2.5">
              {!isLogin && (
                <div>
                  <label className="text-xs font-medium text-muted">Full name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aisha Nakato"
                    className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go/50 focus:ring-2 transition" />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-muted">Email address</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                  <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="you@example.com"
                    className="mt-1 w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go/50 focus:ring-2 transition" />
                </div>
                {email && !emailOk && <p className="mt-0.5 text-[11px] text-warning">Enter a valid email.</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                  <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} placeholder="Min. 6 characters"
                    className="mt-1 w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go/50 focus:ring-2 transition" />
                </div>
                {password && !passOk && <p className="mt-0.5 text-[11px] text-warning">At least 6 characters.</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Morse username<span className="text-warning"> *</span></label>
                <div className="relative">
                  <MorseLogo markOnly className="pointer-events-none absolute left-3 top-[calc(50%+2px)] h-4 w-4 -translate-y-1/2 text-dim" />
                  <input value={morseTag} onChange={(e) => { setMorseTag(e.target.value); setError(""); }} placeholder="Your unique Morse handle"
                    className="mt-1 w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go/50 focus:ring-2 transition" />
                </div>
                <div className="relative mt-2">
                  <MorseLogo markOnly className="pointer-events-none absolute left-3 top-[calc(50%+2px)] h-4 w-4 -translate-y-1/2 text-dim" />
                  <input value={morseTagConfirm} onChange={(e) => { setMorseTagConfirm(e.target.value); setError(""); }} placeholder="Type the same tag again to confirm"
                    className="mt-1 w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go/50 focus:ring-2 transition" />
                </div>
                {morseTag && !morseOk && <p className="mt-0.5 text-[11px] text-warning">Letters, numbers or underscores (3–32 chars).</p>}
                {morseOk && morseTagConfirm && morseTag.trim().replace(/^@/, "").toLowerCase() !== morseTagConfirm.trim().replace(/^@/, "").toLowerCase() && (
                  <p className="mt-0.5 text-[11px] text-warning">The two fields must match.</p>
                )}
                <p className="mt-1.5 rounded-xl bg-surface/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
                  Every GoDoor user confirms their Morse wallet with their unique Morse username.
                  {" "}No Morse wallet yet? Download the Morse app and sign up with GoDoor&apos;s friend code <strong className="text-go">AsAp4f</strong> — it powers GoDoor&apos;s partnership funds.{" "}
                  <a href="https://morsemoney.com/download" target="_blank" rel="noopener noreferrer" className="font-semibold text-go hover:underline">Download Morse →</a>
                </p>
              </div>

              {/* Error message */}
              {error && (
                <div className="rounded-xl bg-danger/15 px-3 py-2.5 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                  <p className="text-xs text-danger">{error}</p>
                </div>
              )}

              {/* Success message */}
              {success && (
                <div className="rounded-xl bg-success/15 px-3 py-2.5 flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  <p className="text-xs text-success">{success}</p>
                </div>
              )}

              <button type="button" disabled={loading || !emailOk || !passOk || (!isLogin && !nameOk) || (!isLogin && !morseOk) || (!isLogin && morseTagConfirm.trim().replace(/^@/, "").toLowerCase() !== morseTag.trim().replace(/^@/, "").toLowerCase()) || cooldown > 0} onClick={handleSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-40 transition active:scale-[0.98]">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : cooldown > 0 ? (
                  <span>Wait {cooldown}s...</span>
                ) : (
                  <><span>{isLogin ? "Sign in" : "Create account"}</span><ArrowRight className="h-4 w-4" /></>
                )}
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <button type="button" onClick={() => { setIsLogin(!isLogin); setError(""); setSuccess(""); }} className="text-xs text-dim underline decoration-dim/50 underline-offset-2 transition hover:text-go hover:decoration-go/60">
                {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </button>
              {step === "auth" && (
                <button type="button" onClick={() => { setStep("role"); setError(""); setSuccess(""); }} className="text-xs text-dim hover:text-fg transition flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
