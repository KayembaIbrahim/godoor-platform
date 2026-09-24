import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid, resolveMerchantWriteAccess } from "@/lib/api-auth";

const ENSURE_BUSINESS_TYPE = `ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'goods';`;

async function ensureBusinessType(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: ENSURE_BUSINESS_TYPE }); } catch {}
}

export async function GET() {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ merchants: [] });
  const { data, error } = await sb.from("merchants").select("*").eq("status", "active").order("rating", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ merchants: [] });
  return NextResponse.json({ merchants: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to register your business" }, { status: 401 });

  if (actor.kind === "user" && actor.role !== "business" && actor.role !== "admin") {
    return NextResponse.json({ error: "Only business accounts can create a store. Apply at /partner instead." }, { status: 403 });
  }

  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "Business name is required" }, { status: 400 });
  }

  const ownerId = actor.kind === "user" ? actor.id : (isUuid(body.owner_id) ? body.owner_id : null);

  await ensureBusinessType(sb);

  const hasLocation = Number(body.lat || 0) !== 0 && Number(body.lng || 0) !== 0;
  const initLat = hasLocation ? Number(body.lat) : 0.3533;
  const initLng = hasLocation ? Number(body.lng) : 32.5822;
  const initDistrict = String(body.district || "").trim() || "Kampala";
  const initArea = String(body.area || "").trim() || "Kampala, Uganda";
  const { data, error } = await sb
    .from("merchants")
    .insert({
      name: String(body.name).trim(),
      category: body.category || "Food",
      business_type: body.business_type === "clinic" ? "clinic" : "goods",
      tagline: body.tagline || "",
      area: initArea,
      district: initDistrict,
      lat: initLat,
      lng: initLng,
      momo_number: body.momo_number || "",
      momo_name: body.momo_name || "",
      opens_at: body.opens_at || "08:00",
      closes_at: body.closes_at || "22:00",
      delivery_fee_ugx: Number(body.delivery_fee_ugx || 3000),
      rating: 0,
      // Auto-active so business receives orders immediately — static Kampala fallback ensures map pin always exists.
      status: "active",
      owner_id: ownerId,
    })
    .select()
    .single();

  if (error) {
    console.error("Create merchant error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ merchant: data });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "Merchant id required" }, { status: 400 });

  // Business name is a protected identity field — it may only be changed via
  // an admin-approved name change request (30-day cooldown), never directly.
  delete patch.name;

  const allowed: Record<string, unknown> = {
    ...(patch.category !== undefined && { category: patch.category }),
    ...(patch.business_type !== undefined && { business_type: patch.business_type === "clinic" ? "clinic" : "goods" }),
    ...(patch.tagline !== undefined && { tagline: patch.tagline }),
    ...(patch.area !== undefined && { area: patch.area }),
    ...(patch.district !== undefined && { district: patch.district }),
    ...(patch.lat !== undefined && { lat: Number(patch.lat) }),
    ...(patch.lng !== undefined && { lng: Number(patch.lng) }),
    ...(patch.momo_number !== undefined && { momo_number: patch.momo_number }),
    ...(patch.momo_name !== undefined && { momo_name: patch.momo_name }),
    ...(patch.opens_at !== undefined && { opens_at: patch.opens_at }),
    ...(patch.closes_at !== undefined && { closes_at: patch.closes_at }),
    ...(patch.delivery_fee_ugx !== undefined && { delivery_fee_ugx: Number(patch.delivery_fee_ugx) }),
    ...(patch.logo_url !== undefined && { logo_url: patch.logo_url }),
    ...(patch.live_location_enabled !== undefined && { live_location_enabled: Boolean(patch.live_location_enabled) }),
    ...(Array.isArray(patch.accepted_payments) && {
      accepted_payments: [...new Set(patch.accepted_payments.filter((p: unknown) => ["cash", "momo", "morse"].includes(String(p))))],
    }),
  };

  // morse_tag is a protected identity field — it is set once and never changed
  // by the business (see POST /api/morse/merchant). It is removed here so an
  // owner can never silently move their payment destination.
  delete patch.morse_tag;

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  await ensureBusinessType(sb);

  if (actor.kind === "admin") {
    // Admin may also set moderation fields
    if (patch.rating !== undefined) allowed.rating = Number(patch.rating);
    if (patch.status !== undefined) allowed.status = String(patch.status);
    if (patch.owner_id !== undefined) allowed.owner_id = isUuid(patch.owner_id) ? patch.owner_id : null;
  } else if (isUuid(id)) {
    // Owners may only edit their own store (unowned stores are claimed on first edit)
    const access = await resolveMerchantWriteAccess(sb, id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  } else {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  if (Object.keys(allowed).length === 0) return NextResponse.json({ merchant: null });

  // Auto-activate pending store when business saves a valid location — fixes lazy bug where store stays pending forever
  try {
    const { data: current } = await sb.from("merchants").select("status,lat,lng").eq("id", id).maybeSingle();
    if (current && (current as any).status === "pending") {
      const hasValidLoc = (allowed.lat !== undefined && Number(allowed.lat) !== 0) || (Number((current as any).lat || 0) !== 0);
      if (hasValidLoc) {
        allowed.status = "active";
      }
    }
  } catch {}

  const { data, error } = await sb.from("merchants").update(allowed).eq("id", id).select().single();
  if (error) {
    console.error("Update merchant error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ merchant: data });
}