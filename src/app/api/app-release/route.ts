import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Public read of the published APK release.
 *
 * The landing page is a client component, so it cannot read app_settings
 * directly. This exposes only the fields a visitor needs - never the whole
 * settings table.
 */
export async function GET() {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ release: null });

  const { data, error } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "apk_release")
    .maybeSingle();

  if (error || !data) return NextResponse.json({ release: null });

  const v = (data.value ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    release: {
      version: typeof v.version === "string" ? v.version : null,
      url: typeof v.url === "string" ? v.url : null,
      size_bytes: typeof v.size_bytes === "number" ? v.size_bytes : null,
      uploaded_at: typeof v.uploaded_at === "string" ? v.uploaded_at : null,
      notes: typeof v.notes === "string" ? v.notes : null,
    },
  });
}
