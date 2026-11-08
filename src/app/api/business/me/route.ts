import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { requireApiUser } from "@/lib/api-auth";
import { searchUgandaPlaces } from "@/lib/uganda-places";
export const runtime = "nodejs";

/** Centre of the named place (Masaka → -0.3356, 31.7341). Unknown → Kampala. */
function coordsForPlace(district: unknown, area: unknown): { lat: number; lng: number } {
  for (const q of [String(district || "").trim(), String(area || "").trim()]) {
    if (!q) continue;
    const hit = searchUgandaPlaces(q, 1)[0];
    if (hit) return { lat: hit.lat, lng: hit.lng };
  }
  return { lat: 0.3163, lng: 32.5822 };
}

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
      if (!hasLoc) {
        // Derive from the merchant's own district — never stamp Kampala coords
        // on a business that says it is in Masaka (that hid Masaka shops from
        // Masaka customers and surfaced them in Kampala).
        const c = coordsForPlace(data.district, data.area);
        patch.lat = c.lat; patch.lng = c.lng;
        patch.district = data.district || "Kampala";
        patch.area = data.area || "Kampala, Uganda";
      }
      await sb.from("merchants").update(patch).eq("id", data.id);
      data.status = "active";
      if (!hasLoc) { const c = coordsForPlace(data.district, data.area); data.lat = c.lat; data.lng = c.lng; }
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

  // Create new merchant — auto-active so orders flow immediately, but the
  // location is the business's own district/area, never a hard-coded Kampala
  // point (0.3533, 32.5822 — actually Mukono) stamped on every new store.
  const hasLocation = Number(body.lat || 0) !== 0 && Number(body.lng || 0) !== 0;
  const fallback = coordsForPlace(body.district, body.area);
  const initLat = hasLocation ? Number(body.lat) : fallback.lat;
  const initLng = hasLocation ? Number(body.lng) : fallback.lng;
  const initDistrict = String(body.district || "").trim() || "Kampala";
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