"use client";

import { WalletPanel } from "@/components/WalletPanel";
import { useSession } from "@/lib/session-store";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { MorseLogo } from "@/components/MorseLogo";
import { Wallet, LogIn, Fingerprint, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import WalletLock from "@/components/WalletLock";

export default function WalletPage() {
  const { onboarded } = useSession();
  const signup = useSignupPrompt();

  return (
    <div className="hero-wash min-h-[70vh]">
      <div className="mx-auto max-w-5xl px-4 pt-10">
        <h1 className="font-display text-3xl font-semibold">Your wallet</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Fund with mobile money. Spend on every GoDoor service.
        </p>
      </div>

      {!onboarded ? (
        <div className="mx-auto max-w-lg px-4 pt-8">
          <div className="rounded-2xl border border-border bg-surface p-6 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-go/15 ring-1 ring-go/20">
              <MorseLogo markOnly className="h-8 w-8 text-go" />
            </div>
            <h2 className="font-display text-lg font-semibold">Create your GoDoor wallet</h2>
            <p className="mt-2 text-sm text-muted">
              Sign up with your phone number to get a GoDoor wallet. Top up via Morse and pay for any delivery across Uganda.
            </p>
            <button
              type="button"
              onClick={() => signup.prompt("/wallet")}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-go px-5 py-3 text-sm font-semibold text-white hover:bg-go-2"
            >
              <LogIn className="h-4 w-4" />
              Create wallet — free
            </button>
            <p className="mt-3 text-xs text-dim">No card needed. Phone + PIN only.</p>
            <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-dim">
              <MorseLogo className="h-2.5" />
              <span>Powered by Morse</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <WalletPanel />
          <WalletSecuritySection />
        </>
      )}

      <SignupModal open={signup.open} onClose={() => signup.setOpen(false)} returnTo={signup.returnTo} />
    </div>
  );
}

/**
 * Wallet security — PIN and fingerprint/face enrolment.
 *
 * Checkout debits the wallet into escrow, so this is where a customer sets up
 * the authorisation that will gate those payments. The PIN is hashed and the
 * biometric signature verified on the server; this component only ever collects
 * the input and hands back the minted grant.
 */
function WalletSecuritySection() {
  const [status, setStatus] = useState<{ hasPin: boolean; hasBiometric: boolean; locked: boolean } | null>(null);
  const [mode, setMode] = useState<"unlock" | "setup" | "setup_pin" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/security", { cache: "no-store" });
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      /* Table not applied yet — the section stays hidden rather than erroring. */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The schema may not be deployed yet; showing a button that always fails is
  // worse than showing nothing.
  if (!status || (!status.hasPin && !status.hasBiometric)) return null;

  return (
    <section id="security" className="mx-auto mt-8 max-w-5xl px-4">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/15 text-go ring-1 ring-go/20">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold">Wallet security</h2>
            <p className="mt-1 text-sm text-muted">
              Confirm every payment with a PIN or your fingerprint, so nobody can spend from your wallet without you.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={status.hasPin ? "text-success" : "text-dim"}>
                {status.hasPin ? "PIN set" : "No PIN"}
              </span>
              <span className="text-dim">·</span>
              <span className={status.hasBiometric ? "text-success" : "text-dim"}>
                {status.hasBiometric ? "Fingerprint / face on" : "No biometric"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("setup")}
                className="inline-flex items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2"
              >
                <ShieldCheck className="h-4 w-4" />
                {status.hasPin || status.hasBiometric ? "Add another method" : "Set up wallet security"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <WalletLock
        mode={mode ?? "setup"}
        open={mode !== null}
        reason="Secure your wallet"
        onCancel={() => setMode(null)}
        onAuthorized={() => { setMode(null); load(); }}
      />
    </section>
  );
}
