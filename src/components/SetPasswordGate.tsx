"use client";

import { useState } from "react";
import { KeyRound, Loader2, Check, Lock, LogOut, AlertTriangle } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { getSupabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import Link from "next/link";

/**
 * First-login gate for riders issued a one-time password. Replaces the
 * dashboard until they set a password of their own. The actual password change
 * runs on the signed-in session (proves ownership); the API route then clears
 * the must-change flag so the gate never loops.
 */
export function SetPasswordGate({ title = "Welcome to GoDoor" }: { title?: string }) {
  const { supabaseUser, profile, setProfile, reset } = useSession();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (pw.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (pw !== confirm) { setError("Passwords do not match."); return; }
    const sb = getSupabase();
    if (!sb) { setError("Accounts are not available right now. Try again soon."); return; }
    setBusy(true);
    try {
      const { error: updateErr } = await sb.auth.updateUser({ password: pw });
      if (updateErr) {
        setError(updateErr.message || "Could not update password.");
        setBusy(false);
        return;
      }
      // Clear the must-change marker on the account.
      fetch("/api/rider/change-password", { method: "DELETE" })
        .catch(() => {})
        .finally(() => {
          setProfile({ mustChangePassword: false });
          setDone(true);
        });
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Try again.");
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-success/15 ring-1 ring-success/30">
          <Check className="h-8 w-8 text-success" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold">Password set</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">
          Your password is now yours alone. Next, upload your National ID and vehicle plate to get verified.
        </p>
        <Link href="/verification"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-semibold text-white hover:bg-go-2 transition">
          Continue to verification
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-4 py-8">
      <div className="flex items-center justify-between">
        <Logo size="sm" />
        <button type="button" onClick={reset}
          className="flex items-center gap-1.5 rounded-lg bg-elevated px-3 py-1.5 text-[11px] font-medium text-muted hover:text-fg transition">
          <LogOut className="h-3 w-3" /> Sign out
        </button>
      </div>

      <div className="mt-10 flex flex-col items-center text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f97316]/15">
          <KeyRound className="h-7 w-7 text-[#f97316]" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          Hi {profile.name?.split(" ")[0] || "rider"}. You&apos;re in with a temporary password set up by GoDoor.
          Set your own password to continue.
        </p>
        <p className="mt-1 text-xs text-dim">Account: {supabaseUser?.email || profile.email || ""}</p>
      </div>

      <div className="mt-8 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted">New password</label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:ring-2 focus-within:ring-go/40">
            <Lock className="h-4 w-4 shrink-0 text-dim" />
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-dim"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted">Confirm password</label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:ring-2 focus-within:ring-go/40">
            <Lock className="h-4 w-4 shrink-0 text-dim" />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-dim"
            />
          </div>
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-danger/15 px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        <button type="button" onClick={submit} disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-go py-3.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {busy ? "Saving…" : "Set my password"}
        </button>

        <p className="text-center text-[11px] text-dim">
          After this you can upload your National ID and vehicle plate to get verified.
        </p>
      </div>
    </div>
  );
}