"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import WalletLock from "@/components/WalletLock";
import { apiAuthHeaders } from "@/lib/db";

/**
 * Wallet security enrolment, shared by all three roles.
 *
 * It used to live only inside /wallet, which made it customer-only in practice:
 * a rider or shop owner with a GoDoor Pay balance had no way to set a PIN, so
 * every authorisation check on their money was skipped.
 *
 * It also only rendered once the user was ALREADY enrolled
 * (`if (!status.hasPin && !status.hasBiometric) return null`), which is
 * backwards — the button that sets the PIN up was invisible to anyone who
 * hadn't set one yet. The section now always renders so enrolment is
 * discoverable, which is the entire point of it.
 */
export default function WalletSecuritySection({
  className = "",
}: {
  className?: string;
}) {
  const [status, setStatus] = useState<{
    hasPin: boolean;
    hasBiometric: boolean;
    locked: boolean;
  } | null>(null);
  const [mode, setMode] = useState<"unlock" | "setup" | "setup_pin" | null>(null);

  const load = useCallback(async () => {
    try {
      // `/api/wallet/security` authorises via `authorize(req)` and 401s without
      // a Supabase Bearer token. This fetch sent none, so `res.ok` was false,
      // `status` stayed null and the section rendered as "not set up" for every
      // user — including signed-in riders and shop owners with a real balance.
      // The PIN/fingerprint enrolment the brief asked for was therefore
      // unreachable from the UI even though the server implemented it.
      const h = await apiAuthHeaders(false);
      const res = await fetch("/api/wallet/security", { cache: "no-store", headers: h });
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      /* Offline — the section renders as "not set up" rather than erroring. */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enrolled = !!status && (status.hasPin || status.hasBiometric);

  return (
    <section id="security" className={className}>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/15 text-go ring-1 ring-go/20">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold">Wallet security</h2>
            <p className="mt-1 text-sm text-muted">
              Confirm every payment with a PIN or your fingerprint, so nobody can spend
              from your wallet without you.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className={status?.hasPin ? "text-success" : "text-dim"}>
                {status?.hasPin ? "PIN set" : "No PIN"}
              </span>
              <span className="text-dim">·</span>
              <span className={status?.hasBiometric ? "text-success" : "text-dim"}>
                {status?.hasBiometric ? "Fingerprint / face on" : "No biometric"}
              </span>
              {!enrolled && (
                <>
                  <span className="text-dim">·</span>
                  <span className="font-semibold text-warning">
                    Your wallet is not protected yet
                  </span>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("setup")}
                className="inline-flex items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go/90 active:scale-95"
              >
                <ShieldCheck className="h-4 w-4" />
                {enrolled ? "Add another method" : "Set up wallet security"}
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
        onAuthorized={() => {
          setMode(null);
          void load();
        }}
      />
    </section>
  );
}
