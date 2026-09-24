import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  try {
    const sql = readFileSync(join(process.cwd(), "SUPABASE_MIGRATION.sql"), "utf8");
    return new NextResponse(sql, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="supabase_migration.sql"',
      },
    });
  } catch {
    return new NextResponse("Migration file not found. See SUPABASE_MIGRATION.sql in the project root.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
