import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, resolveMerchantWriteAccess } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ catalogues: [] });

  const merchantId = req.nextUrl.searchParams.get("merchant_id");
  let query = sb.from("catalogues").select("*").eq("active", true).order("sort_order", { ascending: true });
  if (merchantId) query = query.eq("merchant_id", merchantId);

  const { data, error } = await query;
  return NextResponse.json({ catalogues: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  if (actor.kind === "user") {
    const access = await resolveMerchantWriteAccess(sb, body.merchant_id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const { data, error } = await sb.from("catalogues").upsert({
    id: body.id || `cat_${Date.now().toString(36)}`,
    merchant_id: body.merchant_id,
    name: String(body.name || "").slice(0, 200),
    description: String(body.description || "").slice(0, 1000),
    cover_image_url: body.cover_image_url || "",
    sort_order: Number(body.sort_order || 0),
    active: body.active !== false,
  }, { onConflict: "id" }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ catalogue: data });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const sb = getServiceClient();
  if (!sb || !id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  if (actor.kind === "user") {
    const { data: cat, error: findErr } = await sb.from("catalogues").select("merchant_id").eq("id", id).maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!cat) return NextResponse.json({ ok: true });
    const access = await resolveMerchantWriteAccess(sb, (cat as { merchant_id: string }).merchant_id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const { error } = await sb.from("catalogues").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}