import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveBanner } from "@/lib/hero-banner-server";
import type { HeroAudience } from "@/lib/hero-banner-core";
export const runtime = "nodejs";

/**
 * GET /api/hero-banner — the banner the signed-in audience should see, or null.
 *
 * Public by design. The banner is an advertisement: hiding it behind auth
 * would mean a signed-out visitor sees a different home screen from a signed-in
 * one, and paid slots would go unfilled on exactly the visits that most need
 * them. Nothing here is privileged — it is copy and an image URL that an admin
 * authored and that is already public in the page HTML.
 *
 * The audience narrows which banner comes back, but it is a DISPLAY filter
 * only. It is read from a query parameter and can be spoofed by anyone, which
 * is harmless here precisely because the content is public. It must never be
 * used to decide what a user is allowed to see.
 *
 * Always `force-dynamic`: the answer changes as soon as an admin saves, or as
 * soon as a campaign's end time passes, so it must never be cached at build
 * time or served stale from the edge.
 */
export const dynamic = "force-dynamic";

const AUDIENCES = new Set<string>(["all", "customer", "rider", "business"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("audience") ?? "all";
  const audience: HeroAudience = AUDIENCES.has(raw) ? (raw as HeroAudience) : "all";

  const sb = getServiceClient();
  const banner = await resolveBanner(sb, audience);

  return NextResponse.json(
    { banner },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}