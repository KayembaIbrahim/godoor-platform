"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Banknote, AtSign, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import WalletLock from "@/components/WalletLock";
import { formatUgx } from "@/lib/utils";
import { apiAuthHeaders } from "@/lib/db";

/**
 * Withdraw from GoDoor Pay to your GoDoor Morse wallet.
 *
 * Money leaves to `@your-morse-id` and nowhere else — there is no phone number
 * to type and no mobile-money rail. The destination is read from the signed-in
 * user's own profile by the server, so this sheet shows it rather than asking
 * for it, and a user without a Morse wallet is told how to get one instead of
 * being handed a payout field that would go nowhere.
 *
 * The fee is quoted live from the server's config rather than hardcoded in the
 * sheet, so an admin changing the customer rate changes what people are told
 * before they commit — a 2% they were not expecting is exactly the kind of
 * thing that turns into a support ticket.
 */

type Cfg = {
  enabled: boolean;
  customer_fee_percent: number;
  rider_fee_percent: number;
  business_fee_percent: number;
  min_amount_ugx: number;
  max_amount_ugx: number;
  require_pin: boolean;
};

type Snapshot = {
  config: Cfg;
  role: "customer" | "rider" | "business";
  available: number;
  enrolled: boolean;
  requiresPin: boolean;
  /** The requester's own Morse handle, server-resolved. "" = not set yet. */
  morseTag?: string;
};

function feePercent(cfg: Cfg, role: Snapshot["role"]): number {
  if (role === "rider") return cfg.rider_fee_percent;
  if (role === "business") return cfg.business_fee_percent;
  return cfg.customer_fee_percent;
}

export default function WithdrawSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ net: number; reference: string } | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const pendingAmount = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      // `/api/wallet/withdraw` authorises via `authorize(req)`, which reads the
      // Supabase Bearer token. The session lives in localStorage, so
      // `credentials: "include"` alone carried no credential and the sheet
      // silently loaded no fee config and no balance.
      const h = await apiAuthHeaders(false);
      const res = await fetch("/api/wallet/withdraw", { cache: "no-store", credentials: "include", headers: h });
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
    void load();
  }, [open, load]);

  const amt = Number(amount) || 0;
  const pct = snap ? feePercent(snap.config, snap.role) : 2;
  const fee = Math.round((amt * pct) / 100);
  const net = Math.max(0, amt - fee);

  const submit = useCallback(
    async (grant?: string) => {
      setBusy(true);
      setError("");
      try {
        const auth = await apiAuthHeaders(true);
        const res = await fetch("/api/wallet/withdraw", {
          method: "POST",
          credentials: "include",
          headers: {
            ...auth,
            ...(grant ? { "x-wallet-grant": grant } : {}),
          },
          body: JSON.stringify({ amount: amt }),
        });
        const b = await res.json().catch(() => null);

        if (res.status === 428 && snap?.requiresPin) {
          // Grant expired or was never collected — ask for the lock rather
          // than reporting a failure.
          setBusy(false);
          pendingAmount.current = amt;
          setLockOpen(true);
          return;
        }
        if (!res.ok) {
          setError(b?.error || "Could not complete the withdrawal.");
          setBusy(false);
          return;
        }
        const rec = b?.data?.withdrawal;
        setDone({ net: Number(rec?.net ?? net), reference: String(rec?.reference ?? "") });
        setBusy(false);
        void load();
      } catch {
        setError("Network problem. Check your connection and try again.");
        setBusy(false);
      }
    },
    [amt, net, snap?.requiresPin, load],
  );

  if (!open) return null;

  const morseTag = snap?.morseTag || "";
  const disabled =
    busy ||
    amt <= 0 ||
    !morseTag ||
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
        aria-label="Withdraw to your GoDoor Morse wallet"
        className="relative z-10 w-full max-w-md rounded-t-3xl border border-border bg-bg p-5 pb-8 shadow-2xl sm:rounded-3xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border sm:hidden" />

        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-fg">Withdraw</h2>
            <p className="text-xs text-muted">Paid to your GoDoor Morse wallet.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close withdrawal"
            className="tap-44 grid h-9 w-9 place-items-center rounded-full bg-elevated text-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="mt-6 rounded-2xl border border-success/30 bg-success/10 p-4 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-success" />
            <p className="mt-2 text-sm font-bold text-fg">
              {formatUgx(done.net)} is on its way
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
              Amount (UGX)
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5 focus-within:border-go/60">
                <Banknote className="h-4 w-4 shrink-0 text-muted" />
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder={snap ? String(snap.config.min_amount_ugx) : "10000"}
                  className="num min-w-0 flex-1 bg-transparent text-lg font-bold text-fg outline-none placeholder:text-muted/60"
                />
              </div>
            </label>

            {morseTag ? (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted">Paying out to</p>
                <div className="mt-1 flex items-center gap-2 rounded-2xl border border-go/30 bg-go/10 px-3 py-2.5">
                  <AtSign className="h-4 w-4 shrink-0 text-go" />
                  <span className="min-w-0 flex-1 truncate font-mono text-base font-semibold text-fg">
                    {morseTag}
                  </span>
                  <span className="shrink-0 rounded-full bg-go/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-go">
                    Morse
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <p className="font-semibold">Set your GoDoor Morse ID first</p>
                <p className="mt-1 text-warning/90">
                  Withdrawals are paid to your Morse wallet, so you need a Morse ID
                  before money can be sent.
                </p>
                <Link
                  href="/wallet#morse"
                  onClick={onClose}
                  className="mt-2 inline-block rounded-lg bg-warning px-3 py-1.5 text-[11px] font-bold text-white"
                >
                  Set my Morse ID
                </Link>
              </div>
            )}

            {amt > 0 && (
              <div className="mt-4 space-y-1.5 rounded-2xl border border-border bg-elevated p-3 text-xs">
                <Row label="Withdrawal fee" value={fee === 0 ? "Free" : `-${formatUgx(fee)}`} />
                <Row
                  label="Fee rate"
                  value={pct === 0 ? `${snap?.role ?? ""} — 0%` : `${pct}%`}
                />
                <div className="my-1 border-t border-border" />
                <Row label="You receive" value={formatUgx(net)} strong />
              </div>
            )}

            {snap && !snap.config.enabled && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Withdrawals are paused right now. Your balance is safe.
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
              onClick={() => submit()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-go py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Processing…" : `Withdraw ${amt > 0 ? formatUgx(net) : ""}`}
            </button>

            {snap?.requiresPin && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your wallet PIN or fingerprint will be requested.
              </p>
            )}
          </>
        )}
      </div>

      <WalletLock
        mode="unlock"
        open={lockOpen}
        reason={pendingAmount.current ? `Withdraw ${formatUgx(pendingAmount.current)}` : "Confirm withdrawal"}
        onCancel={() => setLockOpen(false)}
        onAuthorized={(grant) => {
          setLockOpen(false);
          void submit(grant);
        }}
      />
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
