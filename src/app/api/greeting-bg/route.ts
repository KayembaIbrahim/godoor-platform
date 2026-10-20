import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readGreetingBackground } from "@/lib/greeting-bg-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/greeting-bg — the published greeting card artwork.
 *
 * Public by design, for the same reason as `/api/welcome-bg`: the card is
 * decoration, and the three home screens that render it are client components
 * that cannot read `app_settings` directly. Only a PUBLISHED background is
 * returned — a draft preview made by an admin must not leak to every user.
 *
 * `no-store` matters here. An admin who publishes new artwork expects to see
 * it on the next page load, and a cached response would show them the old
 * one and make publishing look broken — which is precisely the class of bug
 * this feature was built to avoid.
 */
export async function GET() {
  const sb = getServiceClient();
  const bg = await readGreetingBackground(sb);
  const published = bg.published ? bg : null;
  return NextResponse.json(
    { background: published },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
