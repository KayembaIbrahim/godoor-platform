import { getSupabase } from "./supabase";

/**
 * Attach the signed-in user's Supabase token to API calls once auth lands.
 *
 * This used to live inside `@/lib/db`, which meant any component that needed an
 * authenticated request had to import the whole 80 KB data layer to reach it.
 * That is fine on `/app` — `QuickReorder` already loads `db.ts` for
 * `fetchOrders` — but not on the public welcome page, where pulling the entire
 * db module in to attach one header is a real cost on a Ugandan mobile
 * connection. It now lives here, with no dependency beyond the Supabase client
 * that `session-store` already pulls in, and `db.ts` re-exports it so every
 * existing call site is untouched.
 *
 * A stale/expired token silently turns every server write into a 401, which
 * used to make orders "succeed" as phantom local-only entries — so refresh the
 * token before sending whenever it is expired or nearly so.
 */
export async function apiAuthHeaders(json: boolean): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  try {
    const sb = getSupabase();
    if (!sb) return h;
    let session = (await sb.auth.getSession()).data.session;
    if (session) {
      const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
      const stale = expiresAtMs <= 0 || expiresAtMs - Date.now() < 60_000;
      if (stale) {
        try {
          const { data: refreshed } = await sb.auth.refreshSession();
          session = refreshed.session || session;
        } catch {}
      }
    }
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  } catch {}
  return h;
}
