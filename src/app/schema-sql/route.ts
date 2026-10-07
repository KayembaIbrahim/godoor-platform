import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { isAdminCookieValid } from "@/lib/api-auth";

/**
 * Serves the full database migration as plain text.
 *
 * This route used to be completely unauthenticated. It sits outside
 * `/api/admin/*`, so `proxy.ts` never saw it, and any anonymous visitor could
 * download the entire schema — every table, column, constraint, index, RLS
 * policy and RPC definition. On a payments platform that is a free map of the
 * whole data model and materially lowers the cost of every other attack.
 *
 * It is now gated behind the same signed admin session as the rest of the
 * portal, and returns a flat 404 when unauthenticated so it does not even
 * confirm that it exists.
 */
export async function GET() {
  if (!(await isAdminCookieValid())) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  try {
    const sql = readFileSync(join(process.cwd(), "SUPABASE_MIGRATION.sql"), "utf8");
    return new NextResponse(sql, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="supabase_migration.sql"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Migration file not found. See SUPABASE_MIGRATION.sql in the project root.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}