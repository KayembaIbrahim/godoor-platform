"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/session-store";
import { getSupabase } from "@/lib/supabase";
import { installFetchDeadline } from "@/lib/net";
import { useOrderNotifications } from "@/lib/use-notifications";
import { FlyerPopup } from "@/components/FlyerPopup";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  // Order/ride alerts and the service worker, app-wide. Must sit above the
  // session restore below so it re-runs once auth is known.
  useOrderNotifications();

  // Restore the Supabase auth session on every page load so the correct
  // role (customer/business/rider) is always restored — never falls back to customer.
  useEffect(() => {
    // Must run before any other effect issues a request. Almost every read in
    // the app was an unbounded `fetch`, so a stalled socket left spinners
    // running forever on a weak connection. Installed here, once, app-wide.
    installFetchDeadline();

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

  return (
    <>
      {children}
      {/* Announcements and flyer promos. Mounted once, app-wide, so a campaign
          can run anywhere without each page opting in — and so there is only
          ever one popup competing for attention. */}
      <FlyerPopup />
    </>
  );
}
