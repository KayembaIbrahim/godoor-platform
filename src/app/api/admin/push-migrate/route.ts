import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Applies a checked-in schema file to the database.
 *
 * Deliberately NOT an SQL console. The file is chosen from a fixed allowlist and
 * read from disk at request time; nothing about the statement text comes from
 * the request, so this cannot be used to run arbitrary SQL. It exists because
 * the Supabase management token available here is scoped to a different
 * account than production, so schema changes need a path from the app.
 *
 * Every statement in the allowlisted files is idempotent.
 */

const ALLOWED_FILES = ["PUSH_SCHEMA.sql", "RIDER_SCHEMA.sql"] as const;

export async function POST(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const url = new URL(req.url);
  const requested = url.searchParams.get("file") || "PUSH_SCHEMA.sql";
  if (!(ALLOWED_FILES as readonly string[]).includes(requested)) {
    return NextResponse.json(
      { error: `Unknown file. Allowed: ${ALLOWED_FILES.join(", ")}` },
      { status: 400 },
    );
  }

  let sql: string;
  try {
    sql = await readFile(`${process.cwd()}/${requested}`, "utf8");
  } catch {
    return NextResponse.json({ error: `${requested} not found` }, { status: 500 });
  }

  // Strip comment-only lines, then split on statement terminators.
  const body = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const statements = body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
    { file: requested, ran: results.length, failed: failed.length, results },
    { status: failed.length ? 500 : 200 },
  );
}
