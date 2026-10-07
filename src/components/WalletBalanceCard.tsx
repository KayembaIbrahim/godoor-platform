"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Eye, EyeOff, Plus, ShieldCheck, Clock, AtSign, LogIn } from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";

/**
 * GoDoor Pay · Morse wallet card for the home screen.
 *
 * Every action here deep-links to a REAL section on /wallet (#topup,
 * #history, #morse, #protection). The previous version had four buttons —
 * Top Up, Scan QR, Transfer, Rewards — where three pointed at the bare
 * /wallet URL and the fourth opened a placeholder box reading "Position QR
 * code inside frame" that scanned nothing. There is no rewards system and no
 * send-money flow in this codebase, so those were buttons that looked like
 * features but did nothing. Advertising them to real customers is worse than
 * showing fewer, working ones.
 */
const ACTIONS = [
  { href: "/wallet#topup", label: "Top Up", Icon: Plus, tone: "text-go" },
  { href: "/wallet#history", label: "History", Icon: Clock, tone: "text-slate-300" },
  { href: "/wallet#morse", label: "Morse ID", Icon: AtSign, tone: "text-slate-300" },
  { href: "/wallet#protection", label: "Protection", Icon: ShieldCheck, tone: "text-emerald-400" },
] as const;

export default function WalletBalanceCard({ className = "" }: { className?: string }) {
  // Session state is the source of truth for "am I signed in". The old code
  // inferred it from a 401 and then linked to /login — a route that has never
  // existed in this app, so the button 404'd. Sign-in is a modal (SignupModal),
  // not a page.
  const signup = useSignupPrompt();
  const [available, setAvailable] = useState<number | null>(null);
  const [escrow, setEscrow] = useState<number | null>(null);

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
    fetch("/api/wallet/balance", { cache: "no-store", credentials: "include" })
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

  const shell = `rounded-3xl border border-white/10 bg-[#131F38] p-4 text-white shadow-lg transition-all hover:border-white/15 ${className}`;

  /* ── Signed out: a real call to action, not an error message ─────────── */
  if (!signedIn) {
    return (
      <>
        <div className={shell}>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-go/15 text-go border border-go/25">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                GoDoor Pay · Morse
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white">
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
            <span className="text-[11px] text-slate-400">to see your balance</span>
          </div>

          <p className="mt-3 flex items-center gap-1.5 border-t border-white/10 pt-3 text-[11px] font-semibold text-emerald-400">
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
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-go/15 text-go border border-go/25">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                GoDoor Pay · Morse
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                {available === null ? (
                  <div className="h-6 w-24 animate-pulse rounded-lg bg-slate-800" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="num rounded-lg bg-[#1B2848] px-2.5 py-0.5 font-display text-lg font-bold tracking-tight text-white border border-white/5">
                      {revealed ? (
                        formatUgx(available)
                      ) : (
                        <span className="text-base tracking-widest text-slate-300">••••••••</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={toggleReveal}
                      aria-label={revealed ? "Hide balance" : "Show balance"}
                      aria-pressed={!revealed}
                      className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition hover:text-white"
                    >
                      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Escrow Safe
          </p>
        </div>

        {escrow !== null && escrow > 0 && (
          <p className="mt-2 text-[10px] text-slate-400">
            {formatUgx(escrow)} held in escrow for active deliveries
          </p>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/10 pt-3">
          {ACTIONS.map(({ href, label, Icon, tone }) => (
            <Link
              key={label}
              href={href}
              className="group flex flex-col items-center gap-1 text-center transition active:scale-95"
            >
              <div
                className={`grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 transition group-hover:bg-go group-hover:text-white ${tone}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-[11px] font-medium text-slate-200 group-hover:text-white">
                {label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <SignupModal
        open={signup.open}
        onClose={() => signup.setOpen(false)}
        returnTo={signup.returnTo}
      />
    </>
  );
}