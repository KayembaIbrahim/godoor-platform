"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { SetNewPasswordForm } from "@/components/SetNewPasswordForm";
import { useSession } from "@/lib/session-store";
import { Loader2 } from "lucide-react";

/**
 * The public page for password reset.
 *
 * Two distinct flows land here:
 *
 * 1. Admin-issued code: /reset-password?token=<codeId>
 *    → Shows the one-time code + new password form (ResetPasswordForm)
 *
 * 2. Self-service (Supabase recovery): user clicks email link → Supabase
 *    verifies recovery token → redirects to /reset-password with a valid
 *    session. No `token` param, but the user is already signed in.
 *    → Shows the "set new password" form (SetNewPasswordForm)
 */
export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const { supabaseUser, authReady } = useSession();
  const [ready, setReady] = useState(false);

  // Wait for auth to be ready so we can reliably distinguish the two flows
  useEffect(() => {
    if (authReady) setReady(true);
  }, [authReady]);

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
        <Loader2 className="h-8 w-8 animate-spin text-go" />
      </div>
    );
  }

  // If there's a token param, always use the code redemption flow (admin-issued)
  if (token) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
        <ResetPasswordForm token={token} />
      </div>
    );
  }

  // No token: if user is signed in (from Supabase recovery redirect), show self-service form
  if (supabaseUser) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
        <SetNewPasswordForm />
      </div>
    );
  }

  // No token, no session: likely a stale/broken link
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-border/80 bg-surface/85 p-5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.55),0_2px_8px_-2px_rgba(15,23,42,0.2)] backdrop-blur-xl sm:p-6">
          <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-left">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs leading-relaxed text-muted">
              This reset link has expired or is invalid. Please{" "}
              <a href="/forgot-password" className="font-semibold underline text-go hover:text-go-2">
                request a new reset link
              </a>
              {" or ask GoDoor support for a one-time code."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
