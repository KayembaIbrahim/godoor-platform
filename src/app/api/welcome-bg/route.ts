import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readWelcomeBackground } from "@/lib/welcome-bg-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/welcome-bg — the published welcome page background.
 *
 * Public by design: the background is decoration on a public sign-in screen,
 * and the welcome page is a client component that cannot read `app_settings`
 * directly. Only a PUBLISHED background is returned — a draft preview made by
 * an admin must not leak to every visitor.
 */
export async function GET() {
  const sb = getServiceClient();
  const bg = await readWelcomeBackground(sb);
  const published = bg.published ? bg : null;
  return NextResponse.json(
    { background: published },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
