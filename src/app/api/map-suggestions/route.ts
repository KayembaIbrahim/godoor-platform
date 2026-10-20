import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/map-suggestions — address autocomplete for the location picker.
 *
 * ── Why Mapbox and not Google ──────────────────────────────────────────────
 * This route used to call the Google Places Autocomplete API with a
 * `GOOGLE_MAPS_API_KEY` that is not present in production, so the endpoint
 * always failed. Mapbox Geocoding v5 is the platform's configured geocoder
 * (`NEXT_PUBLIC_MAPBOX_TOKEN`) and already backs the in-app location search
 * in `src/lib/location.ts`, so this route uses it too. One provider means the
 * suggestion a customer taps and the coordinate the app then stores come from
 * the same place — no provider disagreement.
 *
 * Suggestions are restricted to Uganda, and at most 5 are returned so the
 * picker stays one-handed on a phone.
 */

const MAPBOX_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const MAX_SUGGESTIONS = 5;

function mapboxToken(): string {
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || "";
}

function featurePoint(feature: any): { latitude: number; longitude: number } {
  const c = feature?.center;
  if (Array.isArray(c) && c.length >= 2) {
    return { longitude: Number(c[0]), latitude: Number(c[1]) };
  }
  return { latitude: 0, longitude: 0 };
}

function contextLabel(feature: any): string {
  const ctx = feature?.properties?.context;
  if (!ctx) return "";
  return [ctx.locality?.name, ctx.region?.name, ctx.country?.name]
    .filter(Boolean)
    .join(", ");
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") || searchParams.get("text");
  const lat = searchParams.get("latitude");
  const lng = searchParams.get("longitude");

  if (!q && !(lat && lng)) {
    return NextResponse.json(
      { error: "Please provide either a search query or coordinates" },
      { status: 400 },
    );
  }

  const token = mapboxToken();
  if (!token) {
    return NextResponse.json(
      { error: "Map search is not configured" },
      { status: 503 },
    );
  }

  try {
    let url: string;

    if (q) {
      url =
        `${MAPBOX_BASE}/${encodeURIComponent(q)}.json` +
        `?access_token=${encodeURIComponent(token)}` +
        `&country=UG&language=en&limit=${MAX_SUGGESTIONS}` +
        `&types=address,neighborhood,locality,place`;
    } else {
      const latitude = Number(lat);
      const longitude = Number(lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return NextResponse.json(
          { error: "Invalid coordinates" },
          { status: 400 },
        );
      }
      url =
        `${MAPBOX_BASE}/${longitude.toFixed(7)},${latitude.toFixed(7)}.json` +
        `?access_token=${encodeURIComponent(token)}` +
        `&country=UG&language=en&limit=1&types=address,neighborhood,locality,place`;
    }

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Map search failed" },
        { status: 502 },
      );
    }

    const data = await res.json();
    const features: any[] = Array.isArray(data?.features) ? data.features : [];

    const suggestions = features.slice(0, MAX_SUGGESTIONS).map((feature) => {
      const { latitude, longitude } = featurePoint(feature);
      const label = feature?.place_name || feature?.text || "Unknown place";
      const context = contextLabel(feature);
      return {
        description: label,
        placeId: feature?.id || "",
        latitude,
        longitude,
        formatted_address: label,
        context,
        types: feature?.properties?.feature_type || "",
        structured_formatting: {
          main_text: feature?.text || label,
          secondary_text: context,
        },
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: suggestions,
        timestamp: new Date().toISOString(),
        source: "mapbox",
        count: suggestions.length,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    console.error("Map suggestions error:", err);
    return NextResponse.json(
      { error: "Failed to fetch map suggestions" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { q?: unknown; text?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const q = typeof body.q === "string" ? body.q : body.text;
  if (typeof q !== "string" || !q.trim()) {
    return NextResponse.json(
      { error: "Search query is required in request body" },
      { status: 400 },
    );
  }

  const url = req.nextUrl.clone();
  url.searchParams.set("q", q);
  return GET(url);
}
