import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  clearGreetingBackground,
  isSupportedArtwork,
  looksLikeGif,
  normalizeGreetingBackground,
  readGreetingBackground,
  sanitizeArtworkUrl,
  writeGreetingBackground,
} from "@/lib/greeting-bg-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin management of the greeting card's background artwork.
 *
 * Gated by the admin session cookie — the same gate every other admin
 * mutation uses. The secret path only hides the door; the cookie is the lock.
 *
 *   GET    — read the current artwork (including an unpublished draft)
 *   PUT    — save artwork (publish it, or keep it as a draft preview)
 *   DELETE — reset: the card falls back to the built-in gradient
 *
 * The URL is validated on the SERVER. A `javascript:` URL in an
 * admin-authored string is an XSS vector and a `data:` URL would smuggle
 * markup through `background-image`; both are rejected here rather than
 * escaped later at every call site.
 */

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const background = await readGreetingBackground(sb);
  return NextResponse.json({ background });
}

export async function PUT(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  let body: { imageUrl?: unknown; intensity?: unknown; published?: unknown; isGif?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const imageUrl = sanitizeArtworkUrl(body.imageUrl);
  if (!imageUrl) {
    return NextResponse.json({ error: "A valid https image URL is required" }, { status: 400 });
  }
  if (!isSupportedArtwork(imageUrl)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use JPG, PNG, WebP, AVIF or GIF." },
      { status: 400 },
    );
  }

  const intensity =
    typeof body.intensity === "number" && Number.isFinite(body.intensity)
      ? Math.max(0, Math.min(100, Math.round(body.intensity)))
      : 100;

  const background = normalizeGreetingBackground({
    imageUrl,
    intensity,
    published: Boolean(body.published),
    isGif: typeof body.isGif === "boolean" ? body.isGif : looksLikeGif(imageUrl),
    updatedAt: new Date().toISOString(),
  });

  const ok = await writeGreetingBackground(sb, background);
  if (!ok) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, background });
}

export async function DELETE() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const ok = await clearGreetingBackground(sb);
  if (!ok) return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
