import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, resolveMerchantWriteAccess } from "@/lib/api-auth";

const ENSURE_BULKY_COLUMN = `ALTER TABLE products ADD COLUMN IF NOT EXISTS bulky BOOLEAN NOT NULL DEFAULT false;`;

const ENSURE_SERVICE_COLUMNS = `
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 0;
`;

async function ensureBulkyColumn(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: ENSURE_BULKY_COLUMN }); } catch {}
}

async function ensureServiceColumns(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: ENSURE_SERVICE_COLUMNS }); } catch {}
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ products: [] });

  const merchantId = req.nextUrl.searchParams.get("merchant_id");
  let query = sb.from("products").select("*").order("sort_order", { ascending: true });
  if (merchantId) query = query.eq("merchant_id", merchantId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ products: [] });
  return NextResponse.json({ products: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  // Non-admin writers may only edit products for their own business
  if (actor.kind === "user") {
    const access = await resolveMerchantWriteAccess(sb, body.merchant_id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }

  await ensureBulkyColumn(sb);
  await ensureServiceColumns(sb);

  const payload: Record<string, unknown> = {
    id: body.id || `p_${Date.now().toString(36)}`,
    merchant_id: body.merchant_id,
    name: String(body.name || "").slice(0, 200),
    description: String(body.description || "").slice(0, 1000),
    price: Number(body.price || 0),
    category: body.category || "Food",
    image_url: body.image_url || "",
    available: body.available !== false,
    sort_order: Number(body.sort_order || 0),
    bulky: body.bulky === true,
    is_service: body.is_service === true,
    duration_minutes: Math.max(0, Math.floor(Number(body.duration_minutes || 0))),
  };
  if (!payload.name) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
  const images = Array.isArray(body.images) ? body.images.filter(Boolean).slice(0, 10) : [];
  if (images.length > 0) {
    payload.images = images;
    if (!payload.image_url) payload.image_url = images[0];
  }

  try {
    const { data, error } = await sb.from("products").upsert(payload, { onConflict: "id" }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ product: data });
  } catch (e: any) {
    // products table may not exist yet — client keeps local copy
    return NextResponse.json({ error: e?.message || "products table not ready" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const sb = getServiceClient();
  if (!sb || !id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  if (actor.kind === "user") {
    const { data: product, error: findErr } = await sb.from("products").select("merchant_id").eq("id", id).maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!product) return NextResponse.json({ ok: true }); // already gone / local-only
    const access = await resolveMerchantWriteAccess(sb, (product as { merchant_id: string }).merchant_id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const { error } = await sb.from("products").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}