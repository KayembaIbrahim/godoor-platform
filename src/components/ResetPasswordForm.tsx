"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, CheckCircle2, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { evaluatePassword, type PasswordRequirement } from "@/lib/password-strength";

/**
 * The user-facing half of the one-time-code password reset.
 *
 * The user arrives here from the link the admin sent, with the code arriving
 * by a separate message. They type both, choose a new password, and are done.
 *
 * Nothing here talks to Supabase directly — the redeem route is the only
 * thing that touches the account, and it runs on the service role so it can
 * set a password without a session (the user by definition cannot sign in).
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const strength = useMemo(() => evaluatePassword(password), [password]);
  const requirements: PasswordRequirement[] = strength.requirements;

  if (!token) {
    return (
      <Shell
        title="Open the link we sent you"
        subtitle="This page needs the reset link from GoDoor support. The link looks like godoor.site/reset-password?token=…"
      >
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-left">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-muted">
            No reset code was found in this link. Please ask GoDoor support to send you a new
            link and code — they will arrive separately.
          </p>
        </div>
        <Link
          href="/signin"
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password changed" subtitle="You can now sign in with your new password.">
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-3.5 text-left">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-xs leading-relaxed text-muted">
            Your password has been updated{typeof done === "string" ? ` for ${done}` : ""}. This reset
            code has now been used and cannot be used again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/signin")}
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2"
        >
          Continue to sign in
        </button>
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError("");

    if (!code.trim()) { setError("Enter the one-time code from your message."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    if (!strength.ok) { setError("Choose a stronger password before continuing."); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: token, code: code.trim(), newPassword: password, confirmPassword: confirm }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setDone(typeof d.email === "string" && d.email ? d.email : "");
        setBusy(false);
        return;
      }
      setError(d?.error || "We could not reset your password. Please try again.");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <Shell
      title="Set a new password"
      subtitle="Enter the one-time code GoDoor support sent you, then choose a new password."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="One-time code"
          hint="Looks like GDR-K7QM-3T9P"
          value={code}
          onChange={(v) => setCode(v.toUpperCase())}
          placeholder="GDR-XXXX-XXXX"
          autoComplete="one-time-code"
          inputMode="text"
          spellCheck={false}
          mono
        />

        <Field
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="At least 12 characters"
          type="password"
          autoComplete="new-password"
        />

        {touched && password.length > 0 && (
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

        <Field
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          placeholder="Type it again"
          type="password"
          autoComplete="new-password"
        />

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-left">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="text-xs leading-relaxed text-muted">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {busy ? "Setting your password…" : "Set new password"}
        </button>

        <p className="text-center text-[11px] leading-relaxed text-dim">
          The code works once and expires in 24 hours. If it has expired, ask GoDoor support for a
          new one.
        </p>
      </form>

      <Link
        href="/signin"
        className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted transition hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </Link>
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-lg sm:p-7">
      <div className="flex items-center gap-2.5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/15">
          <KeyRound className="h-5 w-5 text-go" />
        </div>
        <div>
          <h1 className="font-display text-lg font-bold leading-tight">{title}</h1>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  inputMode,
  spellCheck,
  mono,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric";
  spellCheck?: boolean;
  mono?: boolean;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-fg">{label}</span>
        {hint && <span className="text-[10px] text-dim">{hint}</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        spellCheck={spellCheck}
        className={`w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-sm outline-none transition placeholder:text-dim focus:border-go focus:ring-2 focus:ring-go/30 ${mono ? "font-mono tracking-wider uppercase" : ""}`}
      />
    </label>
  );
}
