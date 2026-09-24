"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, ShieldCheck, Eye, EyeOff, KeyRound, AlertTriangle } from "lucide-react";
import { Logo } from "@/components/Logo";

type Step = "password" | "totp";

export default function AdminLogin({ onAuthed }: { onAuthed: () => void }) {
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mx-auto w-fit">
          <Logo size="lg" />
        </div>
        <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface shadow-xl shadow-black/20">
          <div className="bg-gradient-to-br from-go/20 via-primary/10 to-transparent px-6 py-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-go/15 ring-1 ring-go/30">
              {step === "totp" ? <KeyRound className="h-7 w-7 text-go" /> : <ShieldCheck className="h-7 w-7 text-go" />}
            </div>
            <h1 className="mt-4 font-display text-lg font-bold">Admin Portal</h1>
            <p className="mt-1 text-xs text-muted">
              {step === "totp" ? "Enter your security code" : "Sign in to manage GoDoor"}
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
              <p className="text-center text-[10px] text-dim">Protected · GoDoor Admin</p>
            </form>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}