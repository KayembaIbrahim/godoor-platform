"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Eye, EyeOff, Plus } from "lucide-react";
import { formatUgx } from "@/lib/utils";

/**
 * Compact wallet balance for the home screen.
 *
 * Checkout is wallet-only, so a customer cannot discover they need to top up
 * until they reach checkout and are turned away. Surfacing the balance where
 * they land — with a one-tap route to the Morse top-up — closes that gap.
 *
 * Balance is treated as private: masked by default so it is not shoulder-read,
 * and only revealed on an explicit tap. The figure is never cached in storage.
 */
export default function WalletBalanceCard({ className = "" }: { className?: string }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [escrow, setEscrow] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/wallet/balance", { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { data?: { available_balance?: number; escrow_balance?: number } }) => {
        if (!live) return;
        setAvailable(Number(b.data?.available_balance ?? 0));
        setEscrow(Number(b.data?.escrow_balance ?? 0));
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Signed out or wallet unavailable: stay out of the way rather than showing 0,
  // which would wrongly read as "you are broke".
  if (failed) return null;

  const held = escrow && escrow > 0 ? escrow : null;

  return (
    <div className={`rounded-2xl border border-border bg-surface p-3.5 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-go/15">
          <Wallet className="h-4 w-4 text-go" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Wallet balance
          </p>
          {available === null ? (
            <div className="mt-1 h-4 w-24 animate-pulse rounded bg-elevated" />
          ) : (
            <p className="truncate font-display text-base font-bold tabular-nums text-fg">
              {available === 0 ? (
                <span className="text-danger">UGX 0 — top up to order</span>
              ) : revealed ? (
                formatUgx(available)
              ) : (
                <span aria-label="Balance hidden">UGX ••••••</span>
              )}
            </p>
          )}
          {held !== null && (
            <p className="truncate text-[10px] text-muted">
              {formatUgx(held)} held in escrow for active orders
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {available !== null && available > 0 && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? "Hide balance" : "Show balance"}
              title={revealed ? "Hide balance" : "Show balance"}
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-bg text-muted transition hover:text-fg"
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
          <Link
            href="/wallet"
            className="flex items-center gap-1 rounded-lg bg-go px-2.5 py-2 text-[11px] font-bold text-white transition hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Top up
          </Link>
        </div>
      </div>
    </div>
  );
}
