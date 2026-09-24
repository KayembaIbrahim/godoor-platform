"use client";

import { WalletPanel } from "@/components/WalletPanel";
import { useSession } from "@/lib/session-store";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { Wallet, LogIn } from "lucide-react";

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
              <Wallet className="h-6 w-6 text-go" />
            </div>
            <h2 className="font-display text-lg font-semibold">Create your GoDoor wallet</h2>
            <p className="mt-2 text-sm text-muted">
              Sign up with your phone number to get a GoDoor wallet. Top up with MTN MoMo or Airtel Money and pay for any delivery across Uganda.
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
          </div>
        </div>
      ) : (
        <WalletPanel />
      )}

      <SignupModal open={signup.open} onClose={() => signup.setOpen(false)} returnTo={signup.returnTo} />
    </div>
  );
}
