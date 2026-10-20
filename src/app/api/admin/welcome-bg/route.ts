import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  clearWelcomeBackground,
  normalizeSlides,
  readWelcomeBackground,
  sanitizeImageUrl,
  writeWelcomeBackground,
} from "@/lib/welcome-bg-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin management of the welcome page background.
 *
 * Gated by the admin session cookie — the same gate every other admin
 * mutation uses. The secret path only hides the door; the cookie is the lock.
 *
 *   GET    — read the current background (including an unpublished draft)
 *   PUT    — save a background (publish it, or keep it as a draft preview)
 *   DELETE — reset: the welcome page falls back to the built-in gradient
 *
 * The image URL is validated on the SERVER. A `javascript:` URL in an
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
  const background = await readWelcomeBackground(sb);
  return NextResponse.json({ background });
}

export async function PUT(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  let body: {
    imageUrl?: unknown;
    intensity?: unknown;
    published?: unknown;
    slides?: unknown;
    slideDurationMs?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const imageUrl = sanitizeImageUrl(body.imageUrl);
  const slides = normalizeSlides(body.slides);

  // A background with neither an image nor a slide cannot be published —
  // that would leave the welcome screen pointing at nothing.
  if (!imageUrl && slides.length === 0) {
    return NextResponse.json(
      { error: "A valid https image URL or at least one slide is required" },
      { status: 400 },
    );
  }

  const intensity =
    typeof body.intensity === "number" && Number.isFinite(body.intensity)
      ? Math.max(0, Math.min(100, Math.round(body.intensity)))
      : 100;

  const slideDurationMs =
    typeof body.slideDurationMs === "number" && Number.isFinite(body.slideDurationMs)
      ? Math.max(1500, Math.min(60000, Math.round(body.slideDurationMs)))
      : 6000;

  const background = {
    imageUrl,
    intensity,
    published: Boolean(body.published),
    updatedAt: new Date().toISOString(),
    slides,
    slideDurationMs,
  };

  const ok = await writeWelcomeBackground(sb, background);
  if (!ok) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, background });
}

export async function DELETE() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const ok = await clearWelcomeBackground(sb);
  if (!ok) return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
