"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";
import { evaluatePassword, type PasswordRequirement } from "@/lib/password-strength";
import { useSession } from "@/lib/session-store";

/**
 * Sets a new password for a user who is already signed in (from Supabase recovery).
 *
 * This is the "self-service" flow: the user clicked a recovery link in an email
 * (or were redirected from Supabase's recovery process), are already signed in,
 * and need to set their password for the first time (or change an existing one).
 */
export function SetNewPasswordForm() {
  const router = useRouter();
  const { supabaseUser, signOut, setProfile } = useSession.getState();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const strength = useMemo(() => evaluatePassword(password), [password]);
  const requirements: PasswordRequirement[] = strength.requirements;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password || !confirm) { setError("Enter your new password."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    if (!strength.ok) { setError("Choose a stronger password before continuing."); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-new-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: supabaseUser?.email, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setDone(true);
        return;
      }
      setError(d?.error || "We could not update your password. Please try again.");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-border/80 bg-surface/85 p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.55),0_2px_8px_-2px_rgba(15,23,42,0.2)] backdrop-blur-xl sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
              <Lock className="h-5 w-5 text-go" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Password updated</h1>
              <p className="text-sm text-muted">You are now signed in</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-3.5 text-left">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <p className="text-xs leading-relaxed text-muted">
              Your new password has been set successfully for {supabaseUser?.email}. You are now signed in.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/app")}
            className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2"
          >
            Continue to your dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-3xl border border-border/80 bg-surface/85 p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.55),0_2px_8px_-2px_rgba(15,23,42,0.2)] backdrop-blur-xl sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
            <Lock className="h-5 w-5 text-go" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Set a new password</h1>
            <p className="text-sm text-muted">Create a password for {supabaseUser?.email}</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-muted">New password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 12 characters"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2 transition"
              />
            </div>
          </div>

          {password.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-border bg-surface-2 p-3">
              {requirements.map((r) => (
                <li key={r.id} className={`flex items-center gap-2 text-[11px] ${r.met ? "text-success" : "text-dim"}`}>
                  <span className={`grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] ${r.met ? "bg-success/20" : "bg-border"}`}>
                    {r.met ? "✓" : ""}
                  </span>
                  {r.label}
                </li>
              ))}
            </ul>
          )}

          <div>
            <label className="text-xs text-muted">Confirm new password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2 transition"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-left">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <p className="text-xs leading-relaxed text-muted">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-3d btn-3d-brand mt-2 flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {busy ? "Setting password…" : "Set new password"}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => {
              signOut();
              router.push("/signin");
            }}
            className="inline-flex items-center gap-1.5 text-xs text-muted underline decoration-dim/50 underline-offset-2 transition hover:text-go hover:decoration-go/60"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Cancel and sign out
          </button>
        </div>
      </div>
    </div>
  );
}
