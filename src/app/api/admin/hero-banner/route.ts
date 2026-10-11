import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { readBanners, writeBanners } from "@/lib/hero-banner-server";
import { normalizeBanner } from "@/lib/hero-banner-core";

/**
 * Admin management of the sponsored homepage banner.
 *
 * Gated by the admin session cookie, the same gate every other admin mutation
 * uses — the secret path only hides the door, it is not the lock.
 *
 * PUT replaces the whole slot list atomically and validates every entry BEFORE
 * anything is written. That ordering matters: a partial write would leave the
 * portal showing a banner the database does not contain, which for a paid slot
 * is a support call and a refund.
 */

export const dynamic = "force-dynamic";

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const list = await readBanners(sb);
  return NextResponse.json({ banners: list });
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

  const raw = (body as { banners?: unknown })?.banners;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "banners must be an array" }, { status: 400 });
  }
  // A sponsor slot list is small. The cap stops an admin session being used to
  // push an unbounded payload into a single key-value row.
  if (raw.length > 10) {
    return NextResponse.json({ error: "Too many banners" }, { status: 400 });
  }

  // Validate the WHOLE list first, then write. See the note at the top.
  const clean = raw.map(normalizeBanner).filter((b) => b !== null);
  if (clean.length !== raw.length) {
    return NextResponse.json(
      { error: "Every banner needs a headline" },
      { status: 400 },
    );
  }

  const ok = await writeBanners(sb, clean);
  if (!ok) return NextResponse.json({ error: "Save failed" }, { status: 500 });

  return NextResponse.json({ ok: true, banners: clean });
}