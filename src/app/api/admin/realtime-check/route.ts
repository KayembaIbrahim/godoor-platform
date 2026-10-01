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
      "select c.relname as tablename from pg_publication p join pg_publication_rel pr on pr.prpubid = p.oid join pg_class c on c.oid = pr.prrelid where p.pubname = 'supabase_realtime' order by c.relname",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /* Probe: exec_sql is known to run DDL, but if it swallows SELECT result sets
     this whole check reports an empty publication even when tables are members.
     Run a query that must return a row to prove result sets come back. */
  const probe = await sb.rpc("exec_sql", {
    query: "select 'probe_ok' as marker, count(*)::text as n from pg_class where relkind = 'r'",
  });
  const probeRows = (probe.data ?? []) as Record<string, unknown>[];
  const probeOk = probeRows.length > 0 && probeRows[0].marker === "probe_ok";

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
    _probe: { ok: probeOk, rows: probeRows.length, error: probe.error?.message ?? null },
  });
}


/**
 * Adds every watched table to the supabase_realtime publication.
 *
 * Supabase never watches a table unless it is explicitly added, and a table
 * missing from the publication makes postgres_changes silently never fire - no
 * client-side error, the app just falls back to polling and live tracking looks
 * frozen. The publication was found completely empty, so every realtime
 * subscription in the app was dead.
 */
export async function POST() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const WATCHED = [
    "orders",
    "rider_locations",
    "provider_locations",
    "ride_requests",
    "riders",
    "payments",
    "chat_messages",
    "clinic_queue",
  ];

  const before = await sb.rpc("exec_sql", {
    query:
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime'",
  });
  const live = new Set(
    ((before.data ?? []) as Record<string, unknown>[]).map((r) => String(r.tablename)),
  );

  const applied: { statement: string; ok: boolean; error?: string }[] = [];
  for (const t of WATCHED) {
    if (live.has(t)) {
      applied.push({ statement: `add ${t}`, ok: true });
      continue;
    }
    // `alter publication ... add table` errors with 42710 if the table is
    // already a member, so guard on the membership read above.
    const r = await sb.rpc("exec_sql", {
      query: `alter publication supabase_realtime add table public.${t}`,
    });
    applied.push({ statement: `add ${t}`, ok: !r.error, error: r.error?.message });
  }

  const after = await sb.rpc("exec_sql", {
    query:
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename",
  });
  const nowLive = ((after.data ?? []) as Record<string, unknown>[]).map((r) =>
    String(r.tablename),
  );

  return NextResponse.json({
    applied,
    in_publication: nowLive,
    still_missing: WATCHED.filter((t) => !nowLive.includes(t)),
  });
}
