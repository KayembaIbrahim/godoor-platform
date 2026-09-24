"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/session-store";
import { getSupabase } from "@/lib/supabase";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  // Restore the Supabase auth session on every page load so the correct
  // role (customer/business/rider) is always restored — never falls back to customer.
  useEffect(() => {
    void useSession.getState().loadAuthSession();

    // Also listen for auth state changes (token refresh, sign out, etc.)
    const sb = getSupabase();
    if (!sb) return;
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        useSession.setState({
          supabaseUser: null,
          role: null,
          onboarded: false,
        });
        return;
      }
      if (session?.user) {
        void useSession.getState().loadAuthSession();
      }
    });

    return () => { subscription?.unsubscribe?.(); };
  }, []);

  return <>{children}</>;
}
