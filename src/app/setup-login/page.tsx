"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  KeyRound, ShieldCheck, CheckCircle2, Loader2, AlertCircle, ArrowLeft,
  Store, Truck, FileText, Upload, Image as ImageIcon, BadgeCheck, Clock, Building2,
} from "lucide-react";
import { evaluatePassword, type PasswordRequirement } from "@/lib/password-strength";
import { Logo } from "@/components/Logo";

/**
 * Onboarding password-setup page — NOT the reset page.
 *
 * Reached from the link the admin sends to an approved business/rider who
 * was never asked for a password (e.g. Asu Snacks). The link is
 * /setup-login?token=<onboardingCodeId> and the code arrives separately.
 *
 * After setting a password, the user stays on this page to send us their
 * documents — business licence/city certificate OR owner national ID (either
 * one is supported, since some businesses have certificates and some don't),
 * or for riders: vehicle photo + national ID.
 */

const BUSINESS_DOCS = [
  {
    type: "trade_licence",
    label: "Business licence / city certificate",
    desc: "Town/city council trade licence or business certificate, if your business has one.",
  },
  {
    type: "national_id",
    label: "Business owner national ID",
    desc: "Government-issued national ID of the owner. Send this instead of — or in addition to — the licence. Either one is accepted; we support businesses with certificates and businesses without.",
  },
] as const;

const RIDER_DOCS = [
  { type: "vehicle_photo", label: "Vehicle photo", desc: "A clear photo of your bike/car from the side." },
  { type: "national_id", label: "National ID", desc: "Government-issued national ID (front)." },
] as const;

export default function SetupLoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[100dvh] items-center justify-center text-muted">Loading…</div>}>
      <SetupLoginBody />
    </Suspense>
  );
}

function SetupLoginBody() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [lookup, setLookup] = useState<any>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ role: string; email: string } | null>(null);
  const [docsUploaded, setDocsUploaded] = useState(false);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  const [uploadDone, setUploadDone] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);

  const strength = useMemo(() => evaluatePassword(password), [password]);
  const requirements: PasswordRequirement[] = strength.requirements;
  const isRider = (lookup?.role || created?.role) === "rider";
  const docSet = isRider ? RIDER_DOCS : BUSINESS_DOCS;
  const hasAtLeastOneDoc = Object.values(uploadDone).some(Boolean) || docsUploaded;

  // Validate the link on arrival — show who it's for.
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/onboarding-setup?id=${encodeURIComponent(token)}`, { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d?.ok) {
          setLookup(d);
          setDocsUploaded(d.documents_uploaded === true);
        } else {
          setLookupError(d?.error || "This setup link is no longer valid.");
        }
      } catch {
        setLookupError("Could not check this link. Check your connection and try again.");
      }
    })();
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (!code.trim()) { setError("Enter the one-time code from your message."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    if (!strength.ok) { setError("Choose a stronger password before continuing."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: token, code: code.trim(), newPassword: password, confirmPassword: confirm }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setCreated({ role: d.role || "business", email: d.email || "" });
        setBusy(false);
        return;
      }
      setError(d?.error || "We could not set your password. Please try again.");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  };

  const uploadDoc = async (docType: string, file: File) => {
    if (!token) return;
    setUploading((p) => ({ ...p, [docType]: true }));
    setUploadError((p) => ({ ...p, [docType]: "" }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", "verification");
      fd.append("path", `onboarding/${docType}_${Date.now()}.${file.name.split(".").pop()}`);
      fd.append("token", token);
      fd.append("code", code);
      fd.append("doc_type", docType);
      const res = await fetch("/api/onboarding-setup/docs", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setUploadDone((p) => ({ ...p, [docType]: true }));
        setDocsUploaded(true);
      } else {
        setUploadError((p) => ({ ...p, [docType]: d?.error || "Upload failed. Try again." }));
      }
    } catch {
      setUploadError((p) => ({ ...p, [docType]: "Upload failed. Check your connection." }));
    }
    setUploading((p) => ({ ...p, [docType]: false }));
  };

  // ── No token: explain what this page is ──────────────────────────────
  if (!token) {
    return (
      <Shell title="Set up your GoDoor login" subtitle="This page is for businesses and riders who were approved to join GoDoor and need to set their own password.">
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-left">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-muted">
            This page needs the setup link GoDoor sent you. The link looks like
            <span className="block mt-1 font-mono text-[11px] text-fg">godoor.site/setup-login?token=…</span>
            Open the link from our message, then enter the one-time code we sent you separately.
          </p>
        </div>
        <Link href="/partner" className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2">
          Apply to join GoDoor instead
        </Link>
        <Link href="/signin" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted transition hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Link>
      </Shell>
    );
  }

  // ── Invalid/expired link ─────────────────────────────────────────────
  if (lookupError) {
    return (
      <Shell title="Link no longer valid" subtitle="This setup link cannot be used.">
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-left">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed text-muted">{lookupError}</p>
        </div>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-dim">
          Contact GoDoor support on WhatsApp and they will send you a fresh setup link + code.
        </p>
        <Link href="/signin" className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      </Shell>
    );
  }

  // ── Created: now send documents ──────────────────────────────────────
  if (created) {
    return (
      <Shell
        wide
        title={`Welcome aboard${isRider ? ", rider" : ""}!`}
        subtitle={`Your login (${created.email}) is set. Now send us your documents so we can verify you — GoDoor supports both kinds of businesses.`}
      >
        {/* Documents needed */}
        <div className="rounded-2xl border border-go/25 bg-go/5 p-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-go/15">
              {isRider ? <Truck className="h-4.5 w-4.5 text-go" /> : <Building2 className="h-4.5 w-4.5 text-go" />}
            </div>
            <div>
              <p className="text-sm font-bold text-fg">{isRider ? "Rider documents" : "Your business documents"}</p>
              <p className="text-[11px] text-muted">
                {isRider
                  ? "Send both so the admin can verify you."
                  : "Send EITHER document — licence or owner ID. Either one works; some businesses have certificates and some don't; we support both."}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {docSet.map((doc) => {
              const uploadingNow = !!uploading[doc.type];
              const done = !!uploadDone[doc.type];
              const err = uploadError[doc.type];
              return (
                <div key={doc.type} className={`rounded-2xl border p-3.5 transition ${done ? "border-success/40 bg-success/5" : "border-border bg-surface"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${done ? "bg-success/15" : "bg-elevated"}`}>
                      {done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <FileText className="h-5 w-5 text-dim" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">{doc.label}</p>
                      <p className="text-[11px] text-muted">{doc.desc}</p>
                      {done && <p className="mt-1 text-[11px] font-semibold text-success">Sent to GoDoor ✓</p>}
                      {err && <p className="mt-1 text-[11px] font-semibold text-danger">{err}</p>}
                    </div>
                  </div>
                  {!done && !uploadingNow && (
                    <label className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-bg px-3 py-2.5 text-xs font-medium text-muted cursor-pointer transition hover:border-go/50 hover:text-go">
                      {doc.type === "national_id" ? <ImageIcon className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                      {isRider ? "Choose photo" : "Choose file / photo"}
                      <input type="file" accept="image/*,.pdf" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(doc.type, f); }} />
                    </label>
                  )}
                  {uploadingNow && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-elevated/60 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-go" />
            <p className="text-[11px] leading-relaxed text-muted">
              {isRider
                ? "After you send these, the admin verifies you and you can start accepting deliveries."
                : "After you send at least one of these, the admin verifies you and your business appears in the GoDoor catalogue with a trust badge."}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.push(isRider ? "/rider" : "/business")}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white transition hover:bg-go-2"
        >
          {hasAtLeastOneDoc ? "Continue to my dashboard" : "Continue anyway — I'll send documents later"}
        </button>
        <Link href="/signin" className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted transition hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
        </Link>
      </Shell>
    );
  }

  // ── Default: set the password ────────────────────────────────────────
  return (
    <Shell
      title="Set up your login password"
      subtitle={lookup ? `Welcome ${lookup.name ? lookup.name.split(" ")[0] : "to GoDoor"} — enter the code GoDoor sent you, then set your own password.` : "Enter the one-time code GoDoor sent you, then set a password of your own."}
    >
      <form onSubmit={submit} className="space-y-4">
        {lookup && (
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
            <span className={`grid h-8 w-8 place-items-center rounded-lg ${isRider ? "bg-primary/15" : "bg-go/15"}`}>
              {isRider ? <Truck className="h-4 w-4 text-primary" /> : <Store className="h-4 w-4 text-go" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-fg">{lookup.name || "GoDoor partner"}</p>
              <p className="truncate text-[11px] text-dim">{lookup.email} · {isRider ? "Rider" : "Business"}</p>
            </div>
            {lookup.documents_uploaded && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                <BadgeCheck className="h-3 w-3" /> Docs sent
              </span>
            )}
            {!lookup.documents_uploaded && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                <Clock className="h-3 w-3" /> Docs pending
              </span>
            )}
          </div>
        )}

        <Field
          label="One-time code"
          hint="Looks like GDR-XXXX-XXXX"
          value={code}
          onChange={(v) => setCode(v.toUpperCase())}
          placeholder="GDR-XXXX-XXXX"
          autoComplete="one-time-code"
          inputMode="text"
          spellCheck={false}
          mono
        />

        <Field
          label="Your new password"
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
          {busy ? "Setting your password…" : "Set my password"}
        </button>

        <p className="text-center text-[11px] leading-relaxed text-dim">
          The code works once and expires in 24 hours. If it has expired, ask GoDoor support for a new one.
        </p>
      </form>

      <Link href="/signin" className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted transition hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </Link>
    </Shell>
  );
}

function Shell({
  title, subtitle, children, wide,
}: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
      <div className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-3xl border border-border bg-surface p-6 shadow-lg sm:p-7`}>
        <div className="flex items-center justify-between">
          <Logo size="sm" />
        </div>
        <div className="mt-4 flex items-center gap-2.5">
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
    </div>
  );
}

function Field({ label, hint, value, onChange, placeholder, type = "text", autoComplete, inputMode, spellCheck, mono }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; autoComplete?: string; inputMode?: "text" | "numeric"; spellCheck?: boolean; mono?: boolean;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-fg">{label}</span>
        {hint && <span className="text-[10px] text-dim">{hint}</span>}
      </span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        autoComplete={autoComplete} inputMode={inputMode} spellCheck={spellCheck}
        className={`w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-sm outline-none transition placeholder:text-dim focus:border-go focus:ring-2 focus:ring-go/30 ${mono ? "font-mono tracking-wider uppercase" : ""}`} />
    </label>
  );
}
