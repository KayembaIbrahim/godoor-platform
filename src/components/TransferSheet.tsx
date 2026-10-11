"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Send, ShieldCheck, AlertTriangle, Loader2, Mail, ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import WalletLock from "@/components/WalletLock";
import { formatUgx } from "@/lib/utils";
import { apiAuthHeaders } from "@/lib/db";

/**
 * Send GoDoor Pay balance to another GoDoor user by email.
 *
 * The recipient's available balance is credited the moment this succeeds — there
 * is no pending state to approve, because both parties already hold verified
 * GoDoor accounts. What the sender gets instead is a reference that ties the
 * movement to the admin console and to both ledger rows, which is what makes a
 * "my money never arrived" claim answerable.
 *
 * The idempotency key is the subtle part. It is minted once per *intent* — when
 * the sheet opens, when the form changes, and after a success — and deliberately
 * reused across the wallet-lock retry, so a double-tap inside the 90s spend
 * grant window cannot send twice.
 */

type Cfg = {
  enabled: boolean;
  fee_percent: number;
  min_amount_ugx: number;
  max_amount_ugx: number;
  daily_limit_ugx: number;
  require_pin: boolean;
};

type Rec = {
  id: string;
  reference: string;
  /* Both sides of a transfer are shown, so the history needs the counterparty
     in both directions — received rows render `fromEmail`, sent rows `toEmail`. */
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName: string;
  amount: number;
  fee: number;
  feePercent: number;
  net: number;
  status: "completed" | "reversed";
  createdAt: string;
};

type Snapshot = {
  config: Cfg;
  available: number;
  enrolled: boolean;
  requiresPin: boolean;
  sent: Rec[];
  received: Rec[];
  sentToday: number;
};

function newKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function TransferSheet({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  /** Lets the wallet card refresh its balance figure after a send. */
  onSent?: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ net: number; reference: string; to: string } | null>(null);
  const [lockOpen, setLockOpen] = useState(false);

  /* One key per intent — see the note above. */
  const keyRef = useRef<string>(newKey());
  const intentRef = useRef<{ amount: number; email: string; note: string } | null>(null);

  const load = useCallback(async () => {
    try {
      // This route authorises from the Supabase Bearer token, which lives in
      // localStorage — `credentials: "include"` alone carries no credential.
      const h = await apiAuthHeaders(false);
      const res = await fetch("/api/wallet/transfer", {
        cache: "no-store",
        credentials: "include",
        headers: h,
      });
      if (!res.ok) return;
      const b = await res.json();
      if (b?.data) setSnap(b.data as Snapshot);
    } catch {
      /* offline — the sheet still opens, the submit will explain */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setError("");
    keyRef.current = newKey();
    void load();
  }, [open, load]);

  /* Editing the form is a new intent, so it needs a fresh key — otherwise a
     corrected retry after a validation error would be rejected as a duplicate. */
  const changeIntent = useCallback(() => {
    keyRef.current = newKey();
    intentRef.current = null;
  }, []);

  const amt = Number(amount) || 0;
  const pct = snap ? Math.min(50, Math.max(0, Number(snap.config.fee_percent) || 0)) : 0;
  const fee = Math.round((amt * pct) / 100);
  const net = Math.max(0, amt - fee);

  const submit = useCallback(
    async (grant?: string) => {
      /* Freeze the intent on the first attempt of this click sequence so the
         wallet-lock retry sends the identical payload under the identical key. */
      if (!intentRef.current) {
        intentRef.current = { amount: amt, email: email.trim(), note };
        keyRef.current = newKey();
      }
      const intent = intentRef.current;

      setBusy(true);
      setError("");
      try {
        const auth = await apiAuthHeaders(true);
        const res = await fetch("/api/wallet/transfer", {
          method: "POST",
          credentials: "include",
          headers: {
            ...auth,
            ...(grant ? { "x-wallet-grant": grant } : {}),
          },
          body: JSON.stringify({
            amount: intent.amount,
            toEmail: intent.email,
            note: intent.note,
            clientKey: keyRef.current,
          }),
        });
        const b = await res.json().catch(() => null);

        if (res.status === 428 && snap?.requiresPin) {
          // Grant expired or was never collected — ask for the lock rather
          // than reporting a failure.
          setBusy(false);
          setLockOpen(true);
          return;
        }
        if (!res.ok) {
          setError(b?.error || "Could not send the money.");
          setBusy(false);
          intentRef.current = null;
          return;
        }
        const rec = b?.data?.transfer;
        setDone({
          net: Number(rec?.net ?? net),
          reference: String(rec?.reference ?? ""),
          to: String(b?.data?.recipient ?? rec?.toEmail ?? ""),
        });
        setBusy(false);
        intentRef.current = null;
        keyRef.current = newKey();
        void load();
        onSent?.();
      } catch {
        setError("Network problem. Check your connection and try again.");
        setBusy(false);
      }
    },
    [amt, email, note, net, snap?.requiresPin, load, onSent],
  );

  if (!open) return null;

  const emailOk = /\S+@\S+\.\S{2,}/.test(email.trim());
  const disabled =
    busy ||
    amt <= 0 ||
    !emailOk ||
    (snap ? amt > snap.available : true) ||
    (snap ? !snap.config.enabled : false);

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send money to a GoDoor user"
        className="relative z-10 max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-bg p-5 pb-8 shadow-2xl sm:rounded-3xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border sm:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-fg">Send money</h2>
            <p className="text-xs text-muted">
              Instantly to another GoDoor wallet, using their account email.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close send money"
            className="tap-44 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elevated text-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="mt-6 rounded-2xl border border-success/30 bg-success/10 p-4 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-success" />
            <p className="mt-2 text-sm font-bold text-fg">{formatUgx(done.net)} sent</p>
            <p className="mt-1 text-xs text-muted">
              {done.to} now has it in their GoDoor Pay balance.
            </p>
            <p className="mt-1 text-xs text-muted">
              Reference <span className="font-mono font-semibold">{done.reference}</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-go py-3 text-sm font-bold text-white active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-elevated px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Available</span>
              <span className="num font-display text-lg font-bold text-fg">
                {formatUgx(snap?.available ?? 0)}
              </span>
            </div>

            <label className="mt-4 block text-xs font-semibold text-muted">
              Recipient&apos;s GoDoor email
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5 focus-within:border-go/60">
                <Mail className="h-4 w-4 shrink-0 text-muted" />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    changeIntent();
                  }}
                  placeholder="name@example.com"
                  className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-muted/60"
                />
              </div>
            </label>

            <label className="mt-3 block text-xs font-semibold text-muted">
              Amount (UGX)
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5 focus-within:border-go/60">
                <Send className="h-4 w-4 shrink-0 text-muted" />
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^\d]/g, ""));
                    changeIntent();
                  }}
                  placeholder={snap ? String(snap.config.min_amount_ugx) : "10000"}
                  className="num min-w-0 flex-1 bg-transparent text-lg font-bold text-fg outline-none placeholder:text-muted/60"
                />
              </div>
            </label>

            <label className="mt-3 block text-xs font-semibold text-muted">
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 140))}
                placeholder="What is this for?"
                className="mt-1 w-full rounded-2xl border border-border bg-surface px-3 py-2.5 text-sm text-fg outline-none placeholder:text-muted/60 focus:border-go/60"
              />
            </label>

            {amt > 0 && (
              <div className="mt-4 space-y-1.5 rounded-2xl border border-border bg-elevated p-3 text-xs">
                <Row label="Transfer fee" value={fee === 0 ? "Free" : `-${formatUgx(fee)}`} />
                <div className="my-1 border-t border-border" />
                <Row label="They receive" value={formatUgx(net)} strong />
                {snap && snap.sentToday > 0 && (
                  <p className="pt-1 text-[11px] text-dim">
                    Sent today: {formatUgx(snap.sentToday)}
                    {snap.config.daily_limit_ugx > 0
                      ? ` of ${formatUgx(snap.config.daily_limit_ugx)}`
                      : ""}
                  </p>
                )}
              </div>
            )}

            {snap && !snap.config.enabled && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Sending money is paused right now. Your balance is safe.
              </p>
            )}

            {error && (
              <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={disabled}
              onClick={() => void submit()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-go py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Sending…" : `Send ${amt > 0 ? formatUgx(net) : ""}`}
            </button>

            {snap?.requiresPin && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your wallet PIN or fingerprint will be requested.
              </p>
            )}

            {snap && (snap.received.length > 0 || snap.sent.length > 0) && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-dim">Recent</p>
                <div className="mt-2 space-y-1.5">
                  {snap.received.slice(0, 3).map((t) => (
                    <HistoryRow
                      key={`in-${t.id}`}
                      dir="in"
                      name={t.fromEmail}
                      net={t.net}
                      at={t.createdAt}
                      status={t.status}
                    />
                  ))}
                  {snap.sent.slice(0, 3).map((t) => (
                    <HistoryRow
                      key={`out-${t.id}`}
                      dir="out"
                      name={t.toEmail}
                      net={t.net}
                      at={t.createdAt}
                      status={t.status}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <WalletLock
        mode="unlock"
        open={lockOpen}
        reason={amt > 0 ? `Send ${formatUgx(amt)}` : "Confirm transfer"}
        onCancel={() => setLockOpen(false)}
        onAuthorized={(grant) => {
          setLockOpen(false);
          void submit(grant);
        }}
      />
    </div>
  );
}

function HistoryRow({
  dir, name, net, at, status,
}: {
  dir: "in" | "out";
  name: string;
  net: number;
  at: string;
  status: Rec["status"];
}) {
  const Icon = dir === "in" ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-elevated px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${dir === "in" ? "text-success" : "text-muted"}`}
        />
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold text-fg">{name}</span>
          <span className="block text-[10px] text-dim">
            {new Date(at).toLocaleDateString("en-GB", { dateStyle: "medium" })}
            {status === "reversed" ? " · reversed" : ""}
          </span>
        </span>
      </span>
      <span
        className={`num shrink-0 text-xs font-bold ${dir === "in" ? "text-success" : "text-muted"}`}
      >
        {dir === "in" ? "+" : "−"}
        {formatUgx(net).replace("UGX ", "")}
      </span>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={strong ? "num text-sm font-bold text-fg" : "num font-semibold text-fg"}>{value}</span>
    </div>
  );
}