"use client";

import { useEffect } from "react";
import { WalletPanel } from "@/components/WalletPanel";
import WalletBalanceCard from "@/components/WalletBalanceCard";
import { useSession } from "@/lib/session-store";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { MorseLogo } from "@/components/MorseLogo";
import { Wallet, LogIn } from "lucide-react";
import WalletSecuritySection from "@/components/WalletSecuritySection";

export default function WalletPage() {
  const { onboarded } = useSession();
  const signup = useSignupPrompt();

  // Clean up orphaned escrow holds on mount (when customer has no active orders)
  useEffect(() => {
    if (!onboarded) return;
    fetch("/api/wallet/cleanup-escrow", { method: "POST" }).catch(() => {});
  }, [onboarded]);

  return (
    <div className="hero-wash min-h-[70vh]">
      <div className="mx-auto max-w-5xl px-4 pt-10">
        <h1 className="font-display text-3xl font-semibold">Your wallet</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Fund with mobile money. Spend on every GoDoor service.
        </p>
      </div>

      {/* The balance card used to live on the customer home screen. It carries
          Send, Withdraw, Top Up, History, Morse ID and Protection, and each of
          those mounts a full-screen sheet with its own PIN prompt. On the home
          screen that meant four hidden modals permanently parented to the page
          customers land on first — and a customer opening the app had to scroll
          past a money panel before seeing a single shop. It now lives here,
          above the panel, where the rest of the wallet already was. */}
      <div className="mx-auto max-w-lg px-4 pt-6">
        <WalletBalanceCard />
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
