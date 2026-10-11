"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, ArrowRight, Clock3 } from "lucide-react";
import { apiAuthHeaders } from "@/lib/api-auth-headers";
import { useSession } from "@/lib/session-store";

/**
 * "Order your favourites again" — past orders, one tap to reorder.
 *
 * Reorder links into the shop rather than mutating the cart directly: the cart
 * holds one shop at a time, so silently replacing someone's basket is worse
 * than one extra tap.
 *
 * WHO IS SIGNED IN is read from the session store, never inferred from an
 * HTTP outcome.
 *
 * This component used to call `fetch("/api/orders?limit=6")` with no
 * `Authorization` header. `/api/orders` authorises with `authorize(req)` and
 * answers `401 "Sign in to continue"` without a Supabase Bearer token — the
 * same defect as the WalletLock sheet. The component read that 401 as "signed
 * out" and rendered "Sign in and your recent orders…" to customers who were
 * signed in, on the very page that requires being signed in.
 *
 * It was worse than a missing header, because it also treated *any* non-OK
 * response — 429, 500, an offline phone — as proof of being signed out. One
 * flaky request told a signed-in customer to sign in.
 *
 * Two fixes, and the second is the durable one:
 *   1. The request now carries a Supabase Bearer token via `apiAuthHeaders`.
 *      That helper is imported from `@/lib/api-auth-headers` rather than
 *      `@/lib/db`: this component also renders on the public welcome page, and
 *      reaching one header function through the 80 KB data layer cost that page
 *      a chunk it does not need.
 *   2. The shelf is gated on `authReady`/`supabaseUser` from `useSession`,
 *      which is the only thing that actually knows who is signed in. A
 *      transport failure can no longer change that answer, so this cannot
 *      regress under any network condition.
 */

type Order = {
  id: string;
  merchant_id: string | null;
  merchant_name: string | null;
  total_ugx: number | null;
  status: string;
  created_at: string;
};

export default function Favourites() {
  /* `authReady` is the distinction that matters: before it flips we do not yet
     know whether anyone is signed in, and showing the prompt then would flash
     "Sign in" at a signed-in customer on every load. */
  const { authReady, supabaseUser } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const signedIn = authReady && !!supabaseUser;

  useEffect(() => {
    if (!authReady) return;
    if (!supabaseUser) {
      setOrders([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/orders", {
          cache: "no-store",
          headers: await apiAuthHeaders(false),
        });
        if (!alive) return;
        // A failed fetch means "no shelf", never "signed out". The 401 branch is
        // intentionally absent: sign-in is decided by the session above, so no
        // response code can talk a signed-in customer into signing in again.
        const json = await res.json().catch(() => null);
        const list: Order[] = Array.isArray(json?.orders) ? json.orders : [];
        setOrders(list.filter((o) => o && o.merchant_id));
      } catch {
        if (alive) setOrders([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authReady, supabaseUser?.id]);

  /* Signed out, or not yet known: render NOTHING.
   *
   * This block used to be a "Sign in and your recent orders…" panel. It was
   * wrong twice over. It could be shown to someone already signed in (see the
   * auth note above), and on the welcome page it duplicated the account CTAs
   * the hero already carries — the page was asking a visitor to sign in twice
   * within one scroll. A shelf is for people who have shelves. */
  if (!signedIn) return null;

  // Signed in but nothing to show — an empty shelf reads as broken, so show none.
  if (!signedIn || orders.length === 0) return null;

  const seen = new Set<string>();
  const recent = orders.filter((o) => {
    const key = o.merchant_id!;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <section id="favourites" className="border-b border-border py-12">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold">
              <Heart className="h-5 w-5 text-go" />
              Order your favourites again
            </h2>
            <p className="mt-1 text-sm text-muted">The kitchens you came back to.</p>
          </div>
          <Link href="/orders" className="tap-44 relative inline-flex min-h-11 items-center text-sm font-semibold text-go">
            All orders
          </Link>
        </div>

        <ul className="mt-5 flex snap-x gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible">
          {recent.map((o) => (
            <li key={o.id} className="w-[13rem] shrink-0 snap-start sm:w-auto">
              <Link
                href={`/app/merchant/${o.merchant_id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:shadow-pop"
              >
                <span className="min-w-0">
                  <span className="block truncate font-display text-sm font-bold">{o.merchant_name}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                    <Clock3 className="h-3 w-3" />
                    Order again
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-go" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}