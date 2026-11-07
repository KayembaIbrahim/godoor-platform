import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { markOnboardingDocumentsUploaded } from "@/lib/password-reset-server";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

/**
 * Document upload from the onboarding setup page (/setup-login).
 *
 * The user at this point has SET their password but is NOT signed in yet
 * (they became able to sign in only after the code redeemed their password;
 * the client deliberately does not auto-sign-in so the upload can finish
 * first). So this route authenticates differently: the caller must prove
 * they hold a valid, un-used onboarding code (the `token` in the form).
 *
 *   POST multipart: file, token, doc_type, bucket?, path?
 *
 * On success: uploads to the `verification` storage bucket (fallback: data
 * URL in the row, like db.ts's uploadVerificationDoc) and inserts a
 * verification_documents row with status "pending" for the user_id on the
 * onboarding code. Then flips documents_uploaded on the code so admin at
 * /admin/verifications and /admin/applications can see "sent documents to us".
 *
 * The code itself is NOT consumed by the upload — after upload, the user
 * continues to their dashboard and signs in with the password they just set.
 */

const ALLOWED_DOC_TYPES = new Set(["trade_licence", "national_id", "vehicle_photo", "shop_photo"]);

async function verifyOnboardingToken(sb: any, token: string, code: string): Promise<{ user_id: string; role: string } | null> {
  if (!token || typeof code !== "string" || !code.trim()) return null;
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", `pwd_reset:${token}`)
    .maybeSingle();
  if (!data) return null;
  let rec: any;
  try { rec = JSON.parse((data as { value?: string }).value || ""); } catch { return null; }
  // The password was just set (code redeemed), so used_at is expected.
  // We only need the code record to identify the user — the password
  // already changed, so the code can no longer be re-used to set another.
  if (!rec || rec.purpose !== "onboarding" || rec.revoked_at) return null;
  if (new Date(rec.expires_at).getTime() <= Date.now()) return null;

  const parts = String(rec.code_hash || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return null;
  const [, salt, hashHex] = parts;
  try {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const body = clean.startsWith("GDR") ? clean.slice(3) : clean;
    const canonical = `GDR${body}`;
    const candidate = scryptSync(canonical, salt, 32);
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length !== candidate.length || !timingSafeEqual(candidate, expected)) return null;
  } catch { return null; }

  return { user_id: rec.user_id, role: rec.role || "business" };
}

export async function POST(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });

  const fd = await req.formData().catch(() => null);
  if (!fd) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const file = fd.get("file") as File | null;
  const token = String(fd.get("token") || "").trim();
  const docType = String(fd.get("doc_type") || "").trim();
  const bucket = String(fd.get("bucket") || "verification").trim() || "verification";
  const requestedPath = String(fd.get("path") || "").trim();

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!ALLOWED_DOC_TYPES.has(docType)) return NextResponse.json({ error: "Unknown document type" }, { status: 400 });
  if (!token) return NextResponse.json({ error: "Missing setup token" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "File is too large (max 8MB)." }, { status: 400 });

  // Authenticate via the onboarding code carried in the form (the user is
  // not signed in yet — that's the whole point of this flow).
  const auth = await verifyOnboardingToken(sb, token, String(fd.get("code") || ""));
  if (!auth) return NextResponse.json({ error: "This setup link is no longer valid. Ask GoDoor for a new one." }, { status: 401 });

  const userId = auth.user_id;
  const role = auth.role === "rider" ? "rider" : "business";
  const ext = (file.name.split(".").pop() || "jpg").replace(/[^A-Za-z0-9]/g, "") || "jpg";
  const filePath = requestedPath || `${role}/${userId}/${docType}_${Date.now()}.${ext}`;

  let fileUrl = "";
  try {
    const { error: uploadErr } = await (sb.storage.from(bucket) as any).upload(filePath, await file.arrayBuffer(), {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });
    if (!uploadErr) {
      const { data: urlData } = (sb.storage.from(bucket) as any).getPublicUrl(filePath);
      fileUrl = urlData?.publicUrl || "";
    }
  } catch {}

  // Fallback matching db.ts: store a data URL when storage is unreachable.
  if (!fileUrl) {
    const buf = Buffer.from(await file.arrayBuffer());
    fileUrl = `data:${file.type || "image/jpeg"};base64,${buf.toString("base64")}`;
  }

  const { error: insertErr } = await sb.from("verification_documents").insert({
    user_id: userId,
    role,
    document_type: docType,
    file_url: fileUrl,
    file_name: file.name,
    status: "pending",
  });
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  await markOnboardingDocumentsUploaded(sb, token);

  return NextResponse.json({ ok: true, doc_type: docType, file_url: fileUrl, user_id: userId, role });
}
