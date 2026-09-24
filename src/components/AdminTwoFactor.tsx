"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Shield, ShieldCheck, ShieldOff, Smartphone, KeyRound, QrCode, Copy, Check,
  Loader2, AlertTriangle, Clock, LogIn, Lock
} from "lucide-react";

type LoginEvent = { t: string; ip: string; ok: boolean };

export default function AdminTwoFactor() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logins, setLogins] = useState<LoginEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // setup flow
  const [setup, setSetup] = useState<"idle" | "qr" | "codes">("idle");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState<number>(-1);

  // disable flow
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/security", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.enabled === "boolean") {
        setEnabled(data.enabled);
        setLogins(Array.isArray(data.logins) ? data.logins : []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const flash = (msg: { ok: boolean; text: string }) => {
    setErr(msg.ok ? "" : msg.text);
    setOkMsg(msg.ok ? msg.text : "");
    setTimeout(() => { setErr(""); setOkMsg(""); }, 5000);
  };

  const startSetup = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/admin/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.qr && data.secret) {
        setQr(data.qr);
        setSecret(data.secret);
        setSetupCode("");
        setSetup("qr");
      } else {
        setErr(data.error || "Could not start setup.");
      }
    } catch {
      setErr("Could not reach the server.");
    } finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    if (!setupCode) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/admin/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", code: setupCode, secret }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && Array.isArray(data.recoveryCodes)) {
        setRecoveryCodes(data.recoveryCodes);
        setEnabled(true);
        setSetup("codes");
        refresh();
      } else {
        setErr(data.error || "That code didn't verify.");
      }
    } catch {
      setErr("Could not reach the server.");
    } finally { setBusy(false); }
  };

  const finishSetup = async () => {
    setSetup("idle");
    setQr(""); setSecret(""); setRecoveryCodes([]); setSetupCode("");
    flash({ ok: true, text: "Two-factor authentication is now enabled." });
  };

  const confirmDisable = async () => {
    if (!disableCode) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/admin/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code: disableCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setEnabled(false);
        setShowDisable(false);
        setDisableCode("");
        flash({ ok: true, text: "Two-factor authentication is now off." });
      } else {
        setErr(data.error || "Could not disable 2FA.");
      }
    } catch {
      setErr("Could not reach the server.");
    } finally { setBusy(false); }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(0);
      setTimeout(() => setCopied(-1), 2000);
    } catch {}
  };

  if (loading) {
    return <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">Loading security settings…</div>;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border p-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-go/10">
          {enabled ? <ShieldCheck className="h-4 w-4 text-go" /> : <Shield className="h-4 w-4 text-go" />}
        </div>
        <div>
          <h2 className="text-sm font-semibold">Two-Factor Authentication</h2>
          <p className="text-[10px] text-muted">Require an authenticator code in addition to the admin password</p>
        </div>
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold ${enabled ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
          {enabled ? "Enabled" : "Off"}
        </span>
      </div>

      <div className="p-5">
        {setup === "qr" && (
          <div className="rounded-xl border border-border bg-bg p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-fg">
              <QrCode className="h-4 w-4 text-go" /> Step 1 — Scan with your authenticator app
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Open Google Authenticator, Ente Auth, Aegis, or 1Password and scan this QR code.
            </p>
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code" className="h-48 w-48 rounded-xl bg-white p-2" />
              <div className="flex-1">
                <p className="text-[10px] font-medium text-muted">Or enter this key manually</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="rounded-lg bg-surface px-3 py-2 text-xs font-bold tracking-widest text-fg">{secret}</code>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(secret).catch(() => {}); }}
                    className="rounded-lg border border-border p-2 text-dim hover:text-fg transition" aria-label="Copy secret">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-4">
                  <p className="text-[10px] font-medium text-muted">Step 2 — Enter the 6-digit code</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      value={setupCode}
                      onChange={(e) => setSetupCode(e.target.value)}
                      inputMode="numeric"
                      placeholder="000000"
                      disabled={busy}
                      className="w-32 rounded-xl border border-border bg-surface px-3 py-2.5 text-center text-base tracking-[0.3em] outline-none ring-go focus:ring-2 disabled:opacity-50"
                    />
                    <button type="button" onClick={confirmSetup} disabled={busy || setupCode.length !== 6}
                      className="flex items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      Verify & enable
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {err && <p className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}
          </div>
        )}

        {setup === "codes" && (
          <div className="rounded-xl border border-success/25 bg-success/5 p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-success">
              <Check className="h-4 w-4" /> Two-factor is enabled!
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Save these backup codes somewhere safe. Each one works exactly once if you ever lose your phone.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {recoveryCodes.map((c, i) => (
                <code key={c} className="rounded-lg bg-surface px-2 py-1.5 text-center text-[10px] font-bold tracking-wider text-fg">{c}</code>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={copyAll}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-muted hover:text-fg transition">
                {copied === 0 ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                Copy all
              </button>
              <button type="button" onClick={finishSetup}
                className="rounded-lg bg-go px-3 py-2 text-[11px] font-semibold text-white hover:bg-go-2 transition">
                Done
              </button>
            </div>
          </div>
        )}

        {setup === "idle" && !enabled && (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5 text-xs text-muted">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-dim" />
              <span>When on, every sign-in needs your password plus a code from your phone. Protects against stolen passwords and session hijacking.</span>
            </div>
            <button type="button" onClick={startSetup} disabled={busy}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              Enable two-factor
            </button>
          </div>
        )}

        {setup === "idle" && enabled && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-xs text-success">
              <ShieldCheck className="h-4 w-4" /> Sign-in now requires your authenticator code.
            </div>
            {!showDisable ? (
              <button type="button" onClick={() => setShowDisable(true)}
                className="flex shrink-0 items-center gap-2 rounded-xl border border-danger/30 px-4 py-2 text-[11px] font-semibold text-danger hover:bg-danger/10 transition">
                <ShieldOff className="h-3.5 w-3.5" /> Turn off 2FA
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="Enter a current code"
                  className="w-40 rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none ring-go focus:ring-2"
                />
                <button type="button" onClick={confirmDisable} disabled={busy || disableCode.length !== 6}
                  className="rounded-xl bg-danger px-3 py-2 text-[11px] font-semibold text-white hover:bg-danger/90 disabled:opacity-50 transition">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
                </button>
                <button type="button" onClick={() => { setShowDisable(false); setDisableCode(""); }}
                  className="rounded-xl border border-border px-3 py-2 text-[11px] font-medium text-muted hover:text-fg transition">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {err && setup !== "qr" && (
          <p className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>
        )}
        {okMsg && (
          <p className="mt-3 rounded-xl border border-success/25 bg-success/10 px-3 py-2 text-xs text-success">{okMsg}</p>
        )}

        {/* Recent admin sign-ins */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-dim">
            <LogIn className="h-3.5 w-3.5" /> Recent admin sign-ins
          </div>
          {logins.length === 0 ? (
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-bg px-4 py-3 text-xs text-muted">
              <Lock className="h-3.5 w-3.5 text-dim" /> No sign-ins recorded yet.
            </div>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {logins.slice(0, 12).map((l, i) => (
                <li key={i} className="flex items-center justify-between rounded-xl bg-bg px-4 py-2.5 text-xs">
                  <span className="flex items-center gap-2 text-muted">
                    <Clock className="h-3 w-3 text-dim" />
                    {new Date(l.t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    <span className="text-dim">·</span>
                    {l.ip}
                  </span>
                  <span className={`flex items-center gap-1 text-[10px] font-semibold ${l.ok ? "text-success" : "text-danger"}`}>
                    {l.ok ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {l.ok ? "OK" : "Failed"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}