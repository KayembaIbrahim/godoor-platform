import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Applies the checked-in push schema to the database.
 *
 * Deliberately NOT an SQL console: the statement text is read from
 * PUSH_SCHEMA.sql at request time and nothing is taken from the request body,
 * so this route cannot be used to run arbitrary SQL. It exists because the
 * Supabase management token available to CI is scoped to a different account
 * than production, and the schema needs a way to be applied from the app.
 *
 * Every statement in the file is idempotent (IF NOT EXISTS / IF EXISTS), so
 * running this repeatedly is safe.
 */

export async function POST() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  let sql: string;
  try {
    const file = process.cwd() + "/PUSH_SCHEMA.sql";
    sql = await readFile(file, "utf8");
  } catch {
    return NextResponse.json({ error: "PUSH_SCHEMA.sql not found" }, { status: 500 });
  }

  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((l) => !l.trim() || l.trim().startsWith("--")));

  const results: { ok: boolean; error?: string }[] = [];
  for (const stmt of statements) {
    try {
      const { error } = await sb.rpc("exec_sql", { query: stmt });
      results.push(error ? { ok: false, error: error.message } : { ok: true });
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json(
    { ran: results.length, failed: failed.length, results },
    { status: failed.length ? 500 : 200 },
  );
}
