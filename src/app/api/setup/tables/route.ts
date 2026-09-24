import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { isAdminCookieValid } from "@/lib/api-auth";

export async function POST() {
  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const results: string[] = [];
  const tables = ["merchants", "orders", "payments", "chat_messages", "rider_locations", "disputes", "riders", "verification_documents", "products", "catalogues", "followers", "stories", "fee_config"];
  const existing: string[] = [];
  const missing: string[] = [];

  for (const table of tables) {
    try {
      const { error } = await sb.from(table).select("*").limit(1);
      const msg = (error?.message || "").toLowerCase();
      const isMissing = error && (msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("not found"));
      if (isMissing) {
        missing.push(table);
      } else {
        existing.push(table);
      }
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("not found")) {
        missing.push(table);
      } else {
        existing.push(table);
      }
    }
  }

  return NextResponse.json({
    results,
    existing,
    missing,
    instructions: missing.length > 0
      ? `Missing tables: ${missing.join(", ")}. Go to Supabase SQL Editor and run SUPABASE_MIGRATION.sql (in the project root).`
      : "All tables exist!",
  });
}
