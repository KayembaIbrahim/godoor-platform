import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { readCampaigns, writeCampaigns } from "@/lib/campaigns-server";
import { sanitizeCampaign, type Campaign } from "@/lib/campaigns-core";

/**
 * Admin management of flyer campaigns.
 *
 * The GET returns the complete list — including disabled, scheduled and expired
 * entries — because the portal has to be able to show and edit things that are
 * not currently running. The public endpoint at /api/campaigns only ever
 * returns what is actually live.
 *
 * Gated by the admin session cookie, the same gate every other admin mutation
 * uses. The cookie is what proves a human passed the password; the secret path
 * only hides the door.
 */

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

/** Caps mirror the core sanitizer so an oversized payload is rejected up front. */
const CampaignIn = z.object({
  id: z.string().max(80).optional(),
  title: z.string().max(120),
  body: z.string().max(600).default(""),
  imageUrl: z.string().max(2048).nullish(),
  ctaLabel: z.string().max(40).nullish(),
  ctaUrl: z.string().max(2048).nullish(),
  tone: z.enum(["brand", "navy", "purple", "success", "gold"]).default("brand"),
  audience: z.enum(["all", "customer", "rider", "business"]).default("all"),
  enabled: z.boolean().default(true),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
  priority: z.coerce.number().int().min(-100).max(100).default(0),
  dismissDays: z.coerce.number().int().min(0).max(365).default(7),
});

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  return NextResponse.json({ campaigns: await readCampaigns(sb) });
}

export async function PUT(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const list = Array.isArray(body) ? body : (body as { campaigns?: unknown })?.campaigns;
  if (!Array.isArray(list)) return NextResponse.json({ error: "Expected a list of campaigns" }, { status: 400 });
  if (list.length > 20) return NextResponse.json({ error: "Too many campaigns (max 20)" }, { status: 400 });

  // Validate the whole list before writing anything — a partial save would
  // leave the portal showing something the database does not contain.
  const parsed: Campaign[] = [];
  for (const item of list) {
    const r = CampaignIn.safeParse(item);
    if (!r.success) {
      return NextResponse.json({ error: r.error.issues[0]?.message ?? "Invalid campaign" }, { status: 400 });
    }
    const c = sanitizeCampaign({ ...r.data, updatedAt: new Date().toISOString() });
    if (!c) return NextResponse.json({ error: "A campaign needs a title or an image" }, { status: 400 });
    parsed.push(c);
  }

  const result = await writeCampaigns(sb, parsed);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, campaigns: result.campaigns });
}
