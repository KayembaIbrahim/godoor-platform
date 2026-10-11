"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, ShieldCheck, Eye, EyeOff, KeyRound, AlertTriangle, HelpCircle, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { recoveryFetch } from "@/lib/admin-recovery-client";
import { evaluatePassword } from "@/lib/password-strength";

type Step = "password" | "totp" | "recover";

const RECOVERY_QUESTION = "What is my childhood nickname?";

export default function AdminLogin({ onAuthed }: { onAuthed: () => void }) {
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Recovery answers + new password.
  const [recoveryOn, setRecoveryOn] = useState(false);
  const [answer, setAnswer] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNew, setShowNew] = useState(false);

  // Only offer "forgot password" if the owner actually set an answer.
  useEffect(() => {
    recoveryFetch("/api/admin/recovery", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: boolean } | null) => setRecoveryOn(Boolean(d?.configured)))
      .catch(() => setRecoveryOn(false));
  }, []);

  useEffect(() => {
    if (step === "totp") codeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const t = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockSeconds]);

  const parseError = (status: number, data: any): string => {
    if (data?.error) return data.error;
    if (status === 429) return "Too many failed attempts. Please wait a few minutes and try again.";
    if (status === 401) return step === "totp" ? "Invalid security code" : "Incorrect password";
    return "Could not sign in. Try again.";
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 && data?.locked_until) {
        setLockSeconds(Math.max(0, Math.ceil((data.locked_until - Date.now()) / 1000)));
      }
      if (res.ok && data.need2fa) {
        setStep("totp");
        setCode("");
      } else if (res.ok && data.ok) {
        onAuthed();
      } else {
        setError(parseError(res.status, data));
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\s+/g, "").toUpperCase() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        onAuthed();
      } else {
        setError(parseError(res.status, data));
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const backToPassword = () => {
    setStep("password");
    setCode("");
    setError("");
  };

  const openRecovery = () => {
    setStep("recover");
    setAnswer(""); setNewPw(""); setConfirmPw("");
    setError(""); setNotice("");
  };

  const submitRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!answer.trim()) { setError("Enter the answer to your security question."); return; }
    if (newPw !== confirmPw) { setError("New password and confirmation do not match."); return; }
    const strength = evaluatePassword(newPw);
    if (!strength.ok) {
      setError("New password is not strong enough. See the requirements below.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await recoveryFetch("/api/admin/recovery", {
        method: "POST",
        body: JSON.stringify({ action: "recover", answer, newPassword: newPw, confirmPassword: confirmPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        // The password is now the new one — send them straight to sign in.
        setPassword(newPw);
        setAnswer(""); setNewPw(""); setConfirmPw("");
        setStep("password");
        setError("");
        setNotice("Password reset. Sign in with your new password.");
        return;
      }
      setError(data.error || "Could not reset the password.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const newPwStrength = evaluatePassword(newPw);
  const newPwMismatch = confirmPw.length > 0 && newPw !== confirmPw;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mx-auto w-fit">
          <Logo size="lg" />
        </div>
        <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface shadow-xl shadow-black/20">
          <div className="bg-gradient-to-br from-go/20 via-primary/10 to-transparent px-6 py-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-go/15 ring-1 ring-go/30">
              {step === "totp" ? <KeyRound className="h-7 w-7 text-go" />
                : step === "recover" ? <HelpCircle className="h-7 w-7 text-go" />
                : <ShieldCheck className="h-7 w-7 text-go" />}
            </div>
            <h1 className="mt-4 font-display text-lg font-bold">Admin Portal</h1>
            <p className="mt-1 text-xs text-muted">
              {step === "totp" ? "Enter your security code"
                : step === "recover" ? "Recover your password"
                : "Sign in to manage GoDoor"}
            </p>
          </div>

          {step === "password" ? (
            <form onSubmit={submitPassword} className="space-y-4 px-6 pb-6">
              <div>
                <label htmlFor="admin-password" className="text-xs font-medium text-muted">Password</label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                  <input
                    id="admin-password"
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter admin password"
                    autoComplete="current-password"
                    disabled={busy}
                    className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-10 text-sm outline-none ring-go focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-fg transition"
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {notice && (
                <p className="flex items-start gap-2 rounded-xl border border-success/25 bg-success/10 px-3 py-2 text-xs text-success">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{notice}</span>
                </p>
              )}
              {error && (
                <p className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {lockSeconds > 0 ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
                  <span>{error}{lockSeconds > 0 ? ` (${lockSeconds}s)` : ""}</span>
                </p>
              )}
              <button
                type="submit"
                disabled={busy || !password}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {busy ? "Signing in…" : "Sign in"}
              </button>
              {recoveryOn ? (
                <button type="button" onClick={openRecovery}
                  className="flex w-full items-center justify-center gap-1.5 text-[11px] text-dim transition hover:text-go">
                  <HelpCircle className="h-3.5 w-3.5" /> Forgot your password?
                </button>
              ) : (
                <p className="text-center text-[10px] text-dim">Protected · GoDoor Admin</p>
              )}
            </form>
          ) : step === "totp" ? (
            <form onSubmit={submitCode} className="space-y-4 px-6 pb-6">
              <div>
                <label htmlFor="admin-code" className="text-xs font-medium text-muted">
                  Authenticator code or recovery code
                </label>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                  <input
                    id="admin-code"
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="6-digit code"
                    disabled={busy}
                    className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-center text-lg tracking-[0.35em] outline-none ring-go focus:ring-2"
                  />
                </div>
              </div>
              {error && (
                <p className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
              )}
              <button
                type="submit"
                disabled={busy || code.length < 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <button
                type="button"
                onClick={backToPassword}
                className="w-full text-center text-[10px] text-dim hover:text-muted transition"
              >
                Back to password
              </button>
            </form>
          ) : (
            <form onSubmit={submitRecovery} className="space-y-4 px-6 pb-6">
              <div className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5">
                <p className="text-[10px] font-medium text-muted">Security question</p>
                <p className="mt-0.5 text-xs font-semibold text-fg">{RECOVERY_QUESTION}</p>
                <p className="mt-1 text-[10px] text-dim">
                  5 wrong answers locks recovery for a few minutes, so take your time.
                </p>
              </div>

              <div>
                <label htmlFor="admin-answer" className="text-xs font-medium text-muted">Your answer</label>
                <div className="relative mt-1.5">
                  <HelpCircle className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                  <input
                    id="admin-answer"
                    type={show ? "text" : "password"}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    autoComplete="off"
                    placeholder="Your childhood nickname"
                    disabled={busy}
                    className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-sm outline-none ring-go focus:ring-2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="admin-newpw" className="text-xs font-medium text-muted">New password</label>
                <div className="relative mt-1.5">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                  <input
                    id="admin-newpw"
                    type={showNew ? "text" : "password"}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                    placeholder="At least 12 characters"
                    disabled={busy}
                    className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-10 text-sm outline-none ring-go focus:ring-2"
                  />
                  <button type="button" onClick={() => setShowNew(!showNew)}
                    aria-label={showNew ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-fg transition">
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPw.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {newPwStrength.requirements.map((r) => (
                      <li key={r.id} className={`flex items-center gap-1.5 text-[10px] ${r.met ? "text-success" : "text-muted"}`}>
                        <CheckCircle2 className={`h-3 w-3 ${r.met ? "text-success" : "text-dim"}`} />
                        {r.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label htmlFor="admin-confirmpw" className="text-xs font-medium text-muted">Confirm new password</label>
                <input
                  id="admin-confirmpw"
                  type={showNew ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                  disabled={busy}
                  className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
                />
                {newPwMismatch && <p className="mt-2 text-[10px] text-danger">Passwords do not match</p>}
              </div>

              {error && (
                <p className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy || !answer.trim() || !newPwStrength.ok || newPwMismatch}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HelpCircle className="h-4 w-4" />}
                {busy ? "Checking…" : "Reset password"}
              </button>
              <button
                type="button"
                onClick={backToPassword}
                className="w-full text-center text-[10px] text-dim hover:text-muted transition"
              >
                Back to password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}