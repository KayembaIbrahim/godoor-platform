"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet, Eye, EyeOff, Plus, ShieldCheck, Clock, AtSign, LogIn, ArrowUpRight, Landmark, Send,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { apiAuthHeaders } from "@/lib/db";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import WithdrawSheet from "@/components/WithdrawSheet";
import TransferSheet from "@/components/TransferSheet";

/**
 * GoDoor Pay · Morse wallet card for the home screen.
 *
 * Answers two questions at a glance, which is the whole point of putting a
 * wallet on the home screen rather than three taps into /wallet:
 *   1. How much can I spend?  → available balance
 *   2. How much of it is locked in live orders? → escrow balance
 *
 * The escrow figure used to render only when it was above zero, so most of the
 * time the card looked like a plain balance and gave no signal that money was
 * committed to an order in progress. It is now always stated, including "UGX 0"
 * and the reason money is not withdrawable while it is held.
 */
const ACTIONS = [
  { href: "/wallet#topup", label: "Top Up", Icon: Plus, tone: "text-go" },
  { href: "/wallet#history", label: "History", Icon: Clock, tone: "text-muted" },
  { href: "/wallet#morse", label: "Morse ID", Icon: AtSign, tone: "text-muted" },
  { href: "/wallet#protection", label: "Protection", Icon: ShieldCheck, tone: "text-success" },
] as const;

export default function WalletBalanceCard({ className = "" }: { className?: string }) {
  // Session state is the source of truth for "am I signed in". The old code
  // inferred it from a 401 and then linked to /login — a route that has never
  // existed in this app, so the button 404'd. Sign-in is a modal (SignupModal),
  // not a page.
  const signup = useSignupPrompt();
  const [available, setAvailable] = useState<number | null>(null);
  const [escrow, setEscrow] = useState<number | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  /**
   * Hidden by DEFAULT was wrong. The balance is the number checkout depends on;
   * masking it behind a tap meant the home screen could not answer "what's in
   * my wallet?" at a glance, which is what people open this card for.
   *
   * The eye is for shoulder-surfing on a shared phone, not for hiding the
   * primary figure. So: visible unless the customer has explicitly chosen to
   * hide it, and that choice persists across devices of the same browser.
   */
  const HIDDEN_KEY = "godoor-wallet-hidden-v1";
  const [revealed, setRevealed] = useState(true);

  const signedIn = !signup.isGuest;

  useEffect(() => {
    try {
      setRevealed(localStorage.getItem(HIDDEN_KEY) !== "1");
    } catch {
      /* Private mode — default to visible. */
    }
  }, []);

  const toggleReveal = useCallback(() => {
    setRevealed((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(HIDDEN_KEY, next ? "0" : "1");
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // `/api/wallet/balance` authorises via `authorize(req)`, which reads the
    // Supabase **Bearer** token — the session lives in localStorage, not a
    // cookie, so `credentials: "include"` sent no usable credential and every
    // read answered 401. The card then left `available`/`escrow` null, which
    // renders a skeleton balance and a literal "In escrow —" for a user who
    // had money in both. Verified live: the same call returns UGX 102,500
    // available / 27,500 in escrow the moment the header is attached.
    apiAuthHeaders(false)
      .then((h) => fetch("/api/wallet/balance", { cache: "no-store", credentials: "include", headers: h }))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { data?: { available_balance?: number; escrow_balance?: number } }) => {
        if (!live) return;
        setAvailable(Number(b.data?.available_balance ?? 0));
        setEscrow(Number(b.data?.escrow_balance ?? 0));
      })
      .catch(() => {
        // Leave `available` null so the balance renders its skeleton. The card
        // itself always stays on screen — a failed fetch must never blank out
        // the one number checkout depends on.
      });
    return () => {
      live = false;
    };
  }, [signedIn]);

  // The withdrawal sheet debits the wallet, so the card has to re-read the
  // balance when it closes rather than showing a figure that no longer exists.
  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const h = await apiAuthHeaders(false);
      const r = await fetch("/api/wallet/balance", { cache: "no-store", credentials: "include", headers: h });
      if (!r.ok) return;
      const b = await r.json();
      setAvailable(Number(b?.data?.available_balance ?? 0));
      setEscrow(Number(b?.data?.escrow_balance ?? 0));
    } catch {}
  }, [signedIn]);

  // Themed panel. The old shell was hardcoded #131F38 with white and slate
  // text, so light mode rendered a dark card floating on a white page.
  const shell = `gd-panel rounded-3xl border p-4 shadow-lg transition-all ${className}`;
  const escrowHeld = (escrow ?? 0) > 0;

  /* ── Signed out: a real call to action, not an error message ─────────── */
  if (!signedIn) {
    return (
      <>
        <div className={shell}>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-go/25 bg-go/15 text-go">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="gd-panel-sub text-[10px] font-bold uppercase tracking-wider">
                GoDoor Pay · Morse
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold">
                Top up once, pay for every GoDoor service
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => signup.prompt("/app")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2 text-xs font-bold text-white transition hover:bg-go/90 active:scale-95"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in
            </button>
            <span className="gd-panel-sub text-[11px]">to see your balance</span>
          </div>

          <p className="gd-panel-hair mt-3 flex items-center gap-1.5 border-t pt-3 text-[11px] font-semibold text-success">
            <ShieldCheck className="h-3.5 w-3.5" />
            Escrow Safe
          </p>
        </div>
        <SignupModal
          open={signup.open}
          onClose={() => signup.setOpen(false)}
          returnTo={signup.returnTo}
        />
      </>
    );
  }

  /* ── Signed in ───────────────────────────────────────────────────────── */
  return (
    <>
      <div className={shell}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-go/25 bg-go/15 text-go">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="gd-panel-sub text-[10px] font-bold uppercase tracking-wider">
                GoDoor Pay · Morse
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                {available === null ? (
                  <div className="h-6 w-24 animate-pulse rounded-lg bg-elevated" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="gd-panel-chip num rounded-lg border px-2.5 py-0.5 font-display text-lg font-bold tracking-tight">
                      {revealed ? (
                        formatUgx(available)
                      ) : (
                        <span className="text-base tracking-widest gd-panel-sub">••••••••</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={toggleReveal}
                      aria-label={revealed ? "Hide balance" : "Show balance"}
                      aria-pressed={!revealed}
                      className="grid h-7 w-7 place-items-center rounded-md gd-panel-sub transition hover:text-fg"
                    >
                      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={() => setTransferOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-elevated px-2.5 py-1.5 text-[11px] font-bold text-fg transition active:scale-95"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-go/30 bg-go/10 px-2.5 py-1.5 text-[11px] font-bold text-go transition active:scale-95"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              Withdraw
            </button>
          </div>
        </div>

        {/* Always stated. A customer reading "available" needs to know whether
            the shortfall is real money or money GoDoor is holding for them. */}
        <div className="gd-panel-hair mt-3 flex items-center justify-between border-t pt-2.5 text-[11px]">
          <span className="gd-panel-sub inline-flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5" />
            In escrow
          </span>
          <span className="num font-semibold">
            {escrow === null ? "—" : formatUgx(escrow)}
            {escrowHeld ? (
              <span className="gd-panel-sub ml-1.5 font-normal">in active orders</span>
            ) : null}
          </span>
        </div>

        <div className="gd-panel-hair mt-3 grid grid-cols-4 gap-2 border-t pt-3">
          {ACTIONS.map(({ href, label, Icon, tone }) => (
            <Link
              key={label}
              href={href}
              className="group flex flex-col items-center gap-1 text-center transition active:scale-95"
            >
              <div
                className={`gd-panel-chip grid h-9 w-9 place-items-center rounded-full border transition group-hover:bg-go group-hover:text-white ${tone}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="gd-panel-sub text-[11px] font-medium group-hover:text-fg">
                {label}
              </span>
            </Link>
          ))}
        </div>

        <p className="gd-panel-sub mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-success">
          <ShieldCheck className="h-3.5 w-3.5" />
          Escrow Safe
        </p>
      </div>

      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => {
          setWithdrawOpen(false);
          void refresh();
        }}
      />
      {/* Sending money debits this wallet, so it refreshes on send rather than
          on close — the sheet reports success itself. */}
      <TransferSheet
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSent={() => void refresh()}
      />
      <SignupModal
        open={signup.open}
        onClose={() => signup.setOpen(false)}
        returnTo={signup.returnTo}
      />
    </>
  );
}
