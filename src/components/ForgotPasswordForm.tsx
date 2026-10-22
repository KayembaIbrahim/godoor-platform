"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, Loader2, CheckCircle, ArrowLeft } from "lucide-react";

/**
 * The "Forgot your password?" entry surface.
 *
 * The user types their email. The server-side route asks Supabase to send a
 * recovery email via its configured SMTP. The email contains a link that takes
 * the user to /reset-password where they set a new password.
 *
 * The response is deliberately uniform — the same message is returned whether
 * the address is registered or not, so the endpoint cannot be used to probe
 * which accounts exist.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError("Enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError("Enter a valid email address."); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const d = await res.json().catch(() => ({}));
      setBusy(false);
      if (res.ok && d?.ok) {
        setSent(true);
      } else {
        setError("We could not start the reset. Please try again in a moment.");
      }
    } catch {
      setBusy(false);
      setError("We could not reach the server. Check your connection and try again.");
    }
  };

  if (sent) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-border/80 bg-surface/85 p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.55),0_2px_8px_-2px_rgba(15,23,42,0.2)] backdrop-blur-xl sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
              <Mail className="h-5 w-5 text-go" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Check your inbox</h1>
              <p className="text-sm text-muted">Reset link on its way</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-3.5 text-left">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <p className="text-xs leading-relaxed text-muted">
              If <span className="font-semibold text-fg">{email}</span> is registered with GoDoor, we have sent a
              password reset link to that address. Please check your inbox — and your spam/junk folder.
            </p>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-dim">
            The reset link expires in 24 hours and can only be used once. If you do not see the email within a
            few minutes, please ask your GoDoor support contact for a hand-issued code.
          </p>

          <Link
            href="/signin"
            className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-3xl border border-border/80 bg-surface/85 p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.55),0_2px_8px_-2px_rgba(15,23,42,0.2)] backdrop-blur-xl sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
            <Mail className="h-5 w-5 text-go" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Forgot your password?</h1>
            <p className="text-sm text-muted">Enter your email and we will send a reset link</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-muted">Email address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="mt-1 w-full rounded-xl border border-border bg-surface pl-9 pr-3 py-2.5 text-sm outline-none ring-go focus:ring-2 transition"
              />
            </div>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="btn-3d btn-3d-brand mt-2 flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {busy ? "Sending reset link…" : "Send reset link"}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-dim">
            Remembered it?{" "}
            <Link href="/signin" className="font-semibold text-go underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
