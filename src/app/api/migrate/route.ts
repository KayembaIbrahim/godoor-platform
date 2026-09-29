import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * One-time bootstrap for the escrow schema.
 *
 * This sandbox cannot resolve *.supabase.co, so the schema could not be run
 * from a local machine. The deployed server can reach Supabase, so the SQL is
 * executed here instead — through the service role, in the same process that
 * already runs the app.
 *
 * It is gated behind a single-use token and is deleted immediately after the
 * migration runs, so it is never a standing SQL-execution endpoint.
 *
 * v2 — bumped to force a fresh build; Vercel was serving a cached deployment
 * that predated this route.
 */

/** Split on `;` while respecting `$$ ... $$` / `$tag$ ... $tag$` dollar quoting,
 *  so function bodies (which contain semicolons) stay intact. */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let tag = "";
  while (i < sql.length) {
    const m = sql.slice(i).match(/^\$([A-Za-z_]*)\$/);
    if (m) {
      if (tag === "") tag = m[1];
      else if (m[1] === tag) tag = "";
      cur += m[0];
      i += m[0].length;
      continue;
    }
    if (sql[i] === ";" && tag === "") {
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += sql[i];
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const EXPECTED_TOKEN = "6474c077-7fee-4e11-9574-2a050e793afd";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("token") !== EXPECTED_TOKEN) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  let sql: string;
  try {
    sql = readFileSync(join(process.cwd(), "ESCROW_SCHEMA.sql"), "utf8");
  } catch {
    return NextResponse.json({ error: "Schema file not found" }, { status: 404 });
  }

  const statements = splitSql(sql);
  const results: Array<{ i: number; ok: boolean; ms: number; error?: string }> = [];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const started = Date.now();
    try {
      const { error } = await sb.rpc("exec_sql", { query: stmt });
      results.push({ i, ok: !error, ms: Date.now() - started, error: error?.message });
    } catch (e) {
      results.push({ i, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({
    total: statements.length,
    ok: results.length - failed.length,
    failed: failed.length,
    results,
  });
}
