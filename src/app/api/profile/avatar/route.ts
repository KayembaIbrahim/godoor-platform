import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * Persist a user's profile photo.
 *
 * ── Why this route exists ───────────────────────────────────────────────────
 * The `profiles` table has carried an `avatar_url` column from the start, but
 * NOTHING in the application ever wrote to it or read it. The avatar upload on
 * the account page wrote only to Supabase auth `user_metadata.avatar`, and the
 * session store read only that mirror — so an avatar set directly on the
 * `profiles` row (by an admin, by a data fix, or by any other client) could
 * never reach the top bar. The column and the UI disagreed about where the
 * picture lives.
 *
 * This route makes the `profiles` row authoritative: the server writes
 * `avatar_url` with the service role (RLS on `profiles` does not grant a user
 * UPDATE on their own row), and the session store now reads that column as the
 * first source of truth — see `src/lib/session-store.ts`.
 *
 * ── Why the URL is constrained ───────────────────────────────────────────────
 * The avatar URL is written verbatim into a column that every signed-in client
 * renders as an `<img src>`. If a user could point it at an arbitrary host,
 * the top bar would become a beacon: a request to that host from every signed
 * in device of that user, carrying their IP and session cookies. So the URL
 * must point at OUR OWN Supabase Storage bucket — nothing else is accepted.
 */
export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body as { url?: unknown } | null)?.url;
  if (typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json({ error: "No avatar URL provided" }, { status: 400 });
  }
  const url = raw.trim();
  if (url.length > 2048) {
    return NextResponse.json({ error: "Avatar URL is too long" }, { status: 400 });
  }

  /* Only our own public storage bucket is acceptable. The path must be
     `/storage/v1/object/public/<bucket>/<file>` under the same Supabase host
     this deployment talks to. */
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "That is not a valid avatar URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Avatar must be served over HTTPS" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let expectedHost = "";
  try {
    if (supabaseUrl) expectedHost = new URL(supabaseUrl).host;
  } catch {
    /* fall through to the host check below */
  }
  if (!expectedHost || parsed.host !== expectedHost) {
    return NextResponse.json({ error: "Avatar must be uploaded to GoDoor storage" }, { status: 400 });
  }
  if (!parsed.pathname.startsWith("/storage/v1/object/public/avatars/")) {
    return NextResponse.json({ error: "Avatar must be uploaded to GoDoor storage" }, { status: 400 });
  }

  /* Write the authoritative row. The user may not have a `profiles` row yet
     (an account created before the profile model landed), so upsert on the
     primary key rather than update. */
  const { error } = await sb
    .from("profiles")
    .upsert({ id: actor.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: "Could not save the avatar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}
