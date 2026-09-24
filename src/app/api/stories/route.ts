import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ stories: [] });

  const merchantId = req.nextUrl.searchParams.get("merchant_id");
  // Only fetch non-expired stories
  let query = sb.from("stories").select("*").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
  if (merchantId) query = query.eq("merchant_id", merchantId);

  const { data, error } = await query;
  return NextResponse.json({ stories: data || [] });
}

// POST — only the merchant that owns the business may post a story for it.
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const merchantId = body.merchant_id;
  if (!isUuid(merchantId)) {
    return NextResponse.json({ error: "A valid business is required" }, { status: 400 });
  }

  const { data: merchant } = await sb.from("merchants").select("owner_id").eq("id", merchantId).maybeSingle();
  if (!merchant) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (actor.kind === "user" && merchant.owner_id !== actor.id) {
    return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
  }

  // Stories expire after 12 hours
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb.from("stories").insert({
    merchant_id: merchantId,
    media_url: String(body.media_url || ""),
    media_type: body.media_type === "video" ? "video" : "image",
    caption: String(body.caption || ""),
    expires_at: expiresAt,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ story: data });
}

// DELETE — only the owning merchant (or admin) may delete a story.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const sb = getServiceClient();
  if (!sb || !id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const { data: story } = await sb.from("stories").select("merchant_id").eq("id", id).maybeSingle();
  if (!story) return NextResponse.json({ ok: true });

  const { data: merchant } = await sb.from("merchants").select("owner_id").eq("id", story.merchant_id).maybeSingle();
  if (actor.kind === "user" && (!merchant || merchant.owner_id !== actor.id)) {
    return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
  }

  await sb.from("stories").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}