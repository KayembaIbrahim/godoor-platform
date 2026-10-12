import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readCampaigns } from "@/lib/campaigns-server";
export const runtime = "edge";

/**
 * Public read of the live flyer campaigns.
 *
 * Public on purpose — a signed-out visitor has to see the flyer too, that is
 * the whole point of a campaign. It returns only campaigns that are actually
 * live for the requesting role, so an expired or scheduled-for-later campaign
 * is never sent and never has to be hidden client-side.
 *
 * Editing lives at /api/admin/campaigns, behind the admin session.
 */
export async function GET(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ campaigns: [] });

  // Absent or empty means "signed out", which only ever sees `all` campaigns.
  // Same rule as isCampaignLive in campaigns-core, deliberately — the two halves
  // of this filter must not drift apart.
  const role = new URL(req.url).searchParams.get("role") ?? "";
  const all = await readCampaigns(sb);

  // `sanitizeCampaign` already stripped unsafe URLs, so the payload the browser
  // receives is safe to render without a second pass. The filter below is what
  // keeps disabled, expired and wrong-audience campaigns from ever being sent.
  const campaigns = all
    .filter((c) => {
      if (!c.enabled) return false;
      if (c.audience !== "all" && c.audience !== role) return false;
      const now = new Date().toISOString();
      if (c.startsAt && now < c.startsAt) return false;
      if (c.endsAt && now >= c.endsAt) return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      imageUrl: c.imageUrl,
      ctaLabel: c.ctaLabel,
      ctaUrl: c.ctaUrl,
      tone: c.tone,
      dismissDays: c.dismissDays,
    }));

  // Short shared cache: every page load asks for this, and a campaign going
  // live should not need a hard refresh to appear.
  return NextResponse.json(
    { campaigns },
    { headers: { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" } },
  );
}
