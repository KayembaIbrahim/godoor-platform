import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  clearGreetingBackground,
  isSupportedArtwork,
  isVideoArtwork,
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
  // A video is legitimate artwork (the card plays it in a <video> element), so
  // it is accepted alongside stills and GIFs. What is NOT accepted is a link
  // that clearly points at a document or a web page — a share page would
  // silently fail to paint, which is the most common paste mistake.
  const isVideo = isVideoArtwork(imageUrl);
  if (!isVideo && !isSupportedArtwork(imageUrl)) {
    return NextResponse.json(
      {
        error:
          "That link points at a document or web page, not an image. Use the direct image file link.",
      },
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
    mediaType: isVideo ? "video" : "image",
    updatedAt: new Date().toISOString(),
  });

  const ok = await writeGreetingBackground(sb, background);
  if (!ok) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  /* The greeting card is rendered on the client, but the card is embedded in
     the customer's, rider's and business home screens — all of which are
     cached. Dropping those caches here means a newly published artwork is
     live on the next request rather than whenever each screen's cache
     happens to expire. */
  revalidatePath("/app");
  revalidatePath("/rider");
  revalidatePath("/business");
  return NextResponse.json({ ok: true, background });
}

export async function DELETE() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const ok = await clearGreetingBackground(sb);
  if (!ok) return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  revalidatePath("/app");
  revalidatePath("/rider");
  revalidatePath("/business");
  return NextResponse.json({ ok: true });
}
