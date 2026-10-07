import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

const ALLOWED_FILES = ["PUSH_SCHEMA.sql", "RIDER_SCHEMA.sql", "APP_SETTINGS_SCHEMA.sql", "REALTIME_SCHEMA.sql"] as const;
type AllowedFile = (typeof ALLOWED_FILES)[number];

/**
 * One literal path per allowlisted file.
 *
 * This route used to do `readFile(`${process.cwd()}/${requested}`)`. The path was
 * dynamic, so Next's output tracing could not tell which file was meant and
 * traced the *entire* project — including `public/` — into the server bundle.
 * That inflates the deployment and can push it past function size limits.
 *
 * Splitting it into a literal per file keeps the same guarantee (callers still
 * cannot name a path, only pick one of these keys) while letting the bundler
 * trace exactly four files.
 */
const FILE_READERS: Record<AllowedFile, () => Promise<string>> = {
  "PUSH_SCHEMA.sql": () => readFile(path.join(process.cwd(), "PUSH_SCHEMA.sql"), "utf8"),
  "RIDER_SCHEMA.sql": () => readFile(path.join(process.cwd(), "RIDER_SCHEMA.sql"), "utf8"),
  "APP_SETTINGS_SCHEMA.sql": () => readFile(path.join(process.cwd(), "APP_SETTINGS_SCHEMA.sql"), "utf8"),
  "REALTIME_SCHEMA.sql": () => readFile(path.join(process.cwd(), "REALTIME_SCHEMA.sql"), "utf8"),
};

export async function POST(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const url = new URL(req.url);
  const requested = (url.searchParams.get("file") || "PUSH_SCHEMA.sql") as AllowedFile;
  if (!ALLOWED_FILES.includes(requested)) {
    return NextResponse.json(
      { error: `Unknown file. Allowed: ${ALLOWED_FILES.join(", ")}` },
      { status: 400 },
    );
  }

  let sql: string;
  try {
    sql = await FILE_READERS[requested]();
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
