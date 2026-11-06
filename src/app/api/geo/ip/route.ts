import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/geo/ip — server-side IP geolocation.
 *
 * Why this exists: the client IP fallback (freeipapi/ipwho from the browser)
 * hits CORS throttles, 307 chains, and 429s, and on a bad network it can take
 * a full GEO_TIMEOUT_MS *before* the next provider runs. The user stares at
 * "Detecting your location…" for 10+ seconds and reports "location not auto
 * filled".
 *
 * Doing it server-side kills two birds at once:
 *   1. No CORS at all — the browser call is treated as a first-party fetch.
 *   2. Vercel hands us the real client IP via x-forwarded-for, and the server
 *      can race providers in parallel and pick the first valid answer.
 */
export async function GET(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const clientIp = forwarded.split(",")[0]?.trim() || "";

  const providers: Array<() => Promise<{ lat: number; lng: number } | null>> = [
    // Primary: ipwho.is — solid 200, Uganda correct.
    async () => {
      const r = await fetch(`https://ipwho.is${clientIp ? `/${clientIp}` : ""}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      if (j.success === false) return null;
      return ncoords(j.latitude, j.longitude);
    },
    // Backup: freeipapi — flaky in-browser, works server-side.
    async () => {
      const r = await fetch(`https://free.freeipapi.com/api/json${clientIp ? `?ip=${clientIp}` : ""}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      return ncoords(j.latitude, j.longitude);
    },
  ];

  const results = await Promise.allSettled(providers.map((p) => p()));
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      return NextResponse.json(
        { success: true, ...r.value, source: "server-ip" },
        { headers: { "Cache-Control": "public, max-age=60" } },
      );
    }
  }
  return NextResponse.json({ success: false, error: "IP geolocation unavailable" }, { status: 503 });
}

function ncoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const latN = Number(lat), lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
  if (latN < -1.5 || latN > 4.5 || lngN < 28 || lngN > 36) return null; // Uganda bounds
  return { lat: latN, lng: lngN };
}
