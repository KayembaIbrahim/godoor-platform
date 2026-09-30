import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Admin APK releases.
 *
 * The landing page advertises the app, so the binary has to be publishable from
 * the same place. Uploads go to the public `apk` bucket; the current release is
 * recorded in app_settings so the landing page can link the real file instead of
 * a "Coming soon" badge.
 *
 * Only an admin may publish, and only an .apk is accepted - this endpoint is
 * reachable from the admin portal, so it must not become a general file host.
 */

const BUCKET = "apk";
const MAX_BYTES = 150 * 1024 * 1024; // 150 MB

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { data: settings } = await sb
    .from("app_settings")
    .select("key, value")
    .eq("key", "apk_release")
    .maybeSingle();

  const raw = (settings?.value ?? null) as Record<string, unknown> | null;
  return NextResponse.json({
    release: raw
      ? {
          version: raw.version ?? null,
          url: raw.url ?? null,
          size_bytes: raw.size_bytes ?? null,
          uploaded_at: raw.uploaded_at ?? null,
          notes: raw.notes ?? null,
        }
      : null,
  });
}

export async function POST(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file") as File | null;
  const version = String(formData?.get("version") || "").trim();
  const notes = String(formData?.get("notes") || "").trim().slice(0, 500);

  if (!file) return NextResponse.json({ error: "No APK provided" }, { status: 400 });
  if (!/\.apk$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .apk files can be published" }, { status: 400 });
  }
  if (file.size <= 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "APK is too large (max 150 MB)" }, { status: 400 });
  }

  // Ensure the bucket exists and is public so the download link works for
  // anyone on the landing page, not just signed-in admins.
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const existing = new Set((buckets || []).map((b) => b.name));
    if (!existing.has(BUCKET)) {
      await sb.storage.createBucket(BUCKET, { public: true });
    }
  } catch {}

  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, "") || `v${Date.now()}`;
  const filePath = `releases/godoor-${safeVersion}.apk`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType: "application/vnd.android.package-archive",
      upsert: true,
    });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 400 });

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(filePath);
  const url = urlData?.publicUrl || "";
  if (!url) return NextResponse.json({ error: "Could not resolve the download URL" }, { status: 500 });

  const record = {
    version: safeVersion,
    url,
    size_bytes: file.size,
    uploaded_at: new Date().toISOString(),
    notes: notes || null,
  };
  const { error: settingsErr } = await sb
    .from("app_settings")
    .upsert({ key: "apk_release", value: record, updated_at: new Date().toISOString() });
  if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, release: record });
}
