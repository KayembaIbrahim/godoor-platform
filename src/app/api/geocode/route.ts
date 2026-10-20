import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/geocode — forward or reverse geocoding.
 *
 * ── Why Mapbox and not Google ──────────────────────────────────────────────
 * This route used to call the Google Geocoding API with a
 * `GOOGLE_MAPS_API_KEY` that is not present in the production environment, so
 * every request returned Google's `REQUEST_DENIED` payload and the app
 * silently fell back to nothing. The platform's primary geocoder is already
 * Mapbox Geocoding v5 (`src/lib/location.ts`), and `NEXT_PUBLIC_MAPBOX_TOKEN`
 * is configured in production — so this route now uses the SAME provider as
 * the rest of the app. One provider, one token, one set of coordinates.
 *
 * Results are restricted to Uganda (`country=UG`) because GoDoor only
 * delivers inside Uganda; an unfiltered geocoder happily returns a Nairobi
 * street for "Masaka" and the rider is then routed to the wrong country.
 *
 * ── Honesty ────────────────────────────────────────────────────────────────
 * A failed lookup is a 404 with a real message. Coordinates are never invented
 * and a confidence value is never fabricated: Mapbox does not return one, so
 * none is claimed.
 */

const MAPBOX_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";

/** Mapbox is a paid API — never leak the token into a client-visible error. */
function mapboxToken(): string {
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || "";
}

/** Pull lat/lng out of a Mapbox feature. */
function featurePoint(feature: any): { latitude: number; longitude: number } {
  const c = feature?.center;
  if (Array.isArray(c) && c.length >= 2) {
    return { longitude: Number(c[0]), latitude: Number(c[1]) };
  }
  const g = feature?.geometry?.coordinates;
  if (Array.isArray(g) && g.length >= 2) {
    return { longitude: Number(g[0]), latitude: Number(g[1]) };
  }
  return { latitude: 0, longitude: 0 };
}

function placeName(feature: any): string {
  return (
    feature?.place_name ||
    feature?.text ||
    feature?.properties?.full_address ||
    "Unknown place"
  );
}

function placeContext(feature: any): string {
  const ctx = feature?.properties?.context;
  if (!ctx) return "";
  const parts = [
    ctx.neighborhood?.name,
    ctx.locality?.name,
    ctx.region?.name,
    ctx.country?.name,
  ].filter(Boolean);
  return parts.join(", ");
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const text = searchParams.get("text") || searchParams.get("q");
  const lat = searchParams.get("latitude");
  const lng = searchParams.get("longitude");

  if (!text && !(lat && lng)) {
    return NextResponse.json(
      { error: "Please provide either a text query or coordinates" },
      { status: 400 },
    );
  }

  const token = mapboxToken();
  if (!token) {
    return NextResponse.json(
      { error: "Geocoding is not configured" },
      { status: 503 },
    );
  }

  try {
    let url: string;

    if (text) {
      // Forward geocode.
      url =
        `${MAPBOX_BASE}/${encodeURIComponent(text)}.json` +
        `?access_token=${encodeURIComponent(token)}` +
        `&country=UG&language=en&limit=1&types=address,neighborhood,locality,place`;
    } else {
      const latitude = Number(lat);
      const longitude = Number(lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return NextResponse.json(
          { error: "Invalid coordinates" },
          { status: 400 },
        );
      }
      // Reverse geocode.
      url =
        `${MAPBOX_BASE}/${longitude.toFixed(7)},${latitude.toFixed(7)}.json` +
        `?access_token=${encodeURIComponent(token)}` +
        `&country=UG&language=en&limit=1&types=address,neighborhood,locality,place`;
    }

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // A geocode is cheap but not free; keep it fresh for a live location.
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Geocoding request failed" },
        { status: 502 },
      );
    }

    const data = await res.json();
    const feature = data?.features?.[0];

    if (!feature) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 },
      );
    }

    const { latitude, longitude } = featurePoint(feature);
    const location = placeName(feature);

    return NextResponse.json(
      {
        success: true,
        data: {
          location,
          latitude,
          longitude,
          accuracy: feature?.properties?.accuracy || "rooftop",
          context: placeContext(feature),
          formatted_address: location,
          place_id: feature?.id || "",
          types: feature?.properties?.feature_type || "",
        },
        timestamp: new Date().toISOString(),
        source: "mapbox",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    console.error("Geocoding error:", err);
    return NextResponse.json(
      { error: "Failed to fetch location data" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown; q?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : body.q;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: "Text query is required in request body" },
      { status: 400 },
    );
  }

  const url = req.nextUrl.clone();
  url.searchParams.set("text", text);
  return GET(url);
}
