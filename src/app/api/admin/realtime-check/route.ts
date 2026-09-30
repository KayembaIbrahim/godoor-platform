import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Reports which tables are in the supabase_realtime publication.
 *
 * Supabase does not watch every table: each one must be explicitly added.
 * A table missing from the publication makes postgres_changes subscriptions
 * silently never fire, with no client-side error - the app just falls back to
 * polling and tracking looks dead.
 */
export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { data, error } = await sb.rpc("exec_sql", {
    query:
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const live = new Set(
    ((data ?? []) as Record<string, unknown>[]).map((r) => String(r.tablename)),
  );
  const watched = [
    "orders",
    "rider_locations",
    "provider_locations",
    "ride_requests",
    "riders",
    "payments",
    "chat_messages",
    "clinic_queue",
  ];
  return NextResponse.json({
    in_publication: [...live].sort(),
    watched: watched.map((t) => ({ table: t, in_publication: live.has(t) })),
    missing: watched.filter((t) => !live.has(t)),
  });
}
