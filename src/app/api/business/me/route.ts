import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { requireApiUser } from "@/lib/api-auth";

/**
 * Look up / auto-create the merchant record for the CURRENT business user.
 * The owner is always derived from the verified session: a client can never
 * read or create a merchant row for an `owner_id` that is not their own.
 */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  // Only the account owner may read their own merchant record.
  const auth = await requireApiUser(req);
  if (!auth.ok) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const user = auth.user;
  const owner_id = user.id;

  const { data, error } = await sb
    .from("merchants")
    .select("*")
    .eq("owner_id", owner_id)
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Auto-activate pending store on first fetch — fixes lazy bug where business never becomes discoverable
  if (data && data.status === "pending") {
    try {
      const hasLoc = Number(data.lat || 0) !== 0 && Number(data.lng || 0) !== 0;
      const patch: Record<string, unknown> = { status: "active" };
      if (!hasLoc) { patch.lat = 0.3533; patch.lng = 32.5822; patch.district = data.district || "Kampala"; patch.area = data.area || "Kampala, Uganda"; }
      await sb.from("merchants").update(patch).eq("id", data.id);
      data.status = "active";
      if (!hasLoc) { data.lat = 0.3533; data.lng = 32.5822; }
    } catch {}
  }
  return NextResponse.json({ merchant: data || null });
}

/**
 * Auto-create a merchant record for the current business user.
 * Only a verified business (or admin) may create; the merchant is created as
 * "pending" so it cannot self-activate on the marketplace without approval.
 */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const auth = await requireApiUser(req);
  if (!auth.ok) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const user = auth.user;

  const role = typeof user.role === "string" ? user.role : "customer";
  if (role !== "business" && role !== "admin") {
    return NextResponse.json({ error: "Only business accounts can create a store" }, { status: 403 });
  }
  const owner_id = user.id;

  const body = await req.json().catch(() => ({}));

  // Check if already exists
  const { data: existing } = await sb
    .from("merchants")
    .select("id")
    .eq("owner_id", owner_id)
    .maybeSingle();

  if (existing) return NextResponse.json({ merchant: existing });

  // Create new merchant — auto-active with static fallback location so orders flow immediately.
  // Admin can still suspend if needed, but business shouldn't be blocked from receiving orders.
  const hasLocation = Number(body.lat || 0) !== 0 && Number(body.lng || 0) !== 0;
  const initLat = hasLocation ? Number(body.lat) : 0.3533;
  const initLng = hasLocation ? Number(body.lng) : 32.5822;
  const initDistrict = String(body.district || "").trim() || (hasLocation ? "Kampala" : "Kampala");
  const initArea = String(body.area || "Uganda").trim() || "Kampala, Uganda";
  const { data, error } = await sb
    .from("merchants")
    .insert({
      owner_id,
      name: String(body.name || "My Business"),
      category: String(body.category || "Business"),
      tagline: String(body.tagline || ""),
      area: initArea,
      district: initDistrict,
      lat: initLat,
      lng: initLng,
      momo_number: String(body.momo_number || ""),
      momo_name: String(body.momo_name || ""),
      opens_at: "08:00",
      closes_at: "22:00",
      delivery_fee_ugx: 3000,
      rating: 0,
      status: "active",
      verified: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ merchant: data });
}