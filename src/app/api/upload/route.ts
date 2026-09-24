import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize, isUuid, resolveMerchantWriteAccess } from "@/lib/api-auth";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const bucket = (formData.get("bucket") as string) || "store-photos";
  const path = (formData.get("path") as string) || "";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  // Verify the caller may write to the merchant/product this upload targets.
  const parts = path.split("/");
  if (bucket === "store-photos" && actor.kind === "user") {
    const merchantId = parts.length >= 2 && isUuid(parts[1]) ? parts[1] : (parts.length >= 1 && isUuid(parts[0]) ? parts[0] : "");
    if (!merchantId) return NextResponse.json({ error: "Invalid merchant path" }, { status: 400 });
    const access = await resolveMerchantWriteAccess(sb, merchantId, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }
  if (bucket === "product-images" && actor.kind === "user") {
    const { data: product } = await sb.from("products").select("merchant_id").eq("id", parts[0] || "").maybeSingle();
    if (parts.length < 1 || !product) return NextResponse.json({ error: "Product not found" }, { status: 403 });
    const access = await resolveMerchantWriteAccess(sb, (product as { merchant_id: string }).merchant_id, actor.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });
  }

  // Ensure bucket exists — create if missing
  const BUCKETS = ["store-photos", "chat-images", "product-images", "verification", "avatars", "stories", "catalogue-images"];
  try {
    const { data: buckets } = await sb.storage.listBuckets();
    const existing = new Set((buckets || []).map((b) => b.name));
    if (!existing.has(bucket)) {
      await sb.storage.createBucket(bucket, { public: true });
    }
    for (const b of BUCKETS) {
      if (!existing.has(b)) {
        sb.storage.createBucket(b, { public: true }).catch(() => {});
      }
    }
  } catch {}

  const ext = file.name.split(".").pop() || "jpg";
  const filePath = path || `uploads/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await sb.storage
    .from(bucket)
    .upload(filePath, buffer, { contentType: file.type, upsert: true });

  if (uploadErr) {
    console.error("Upload error:", uploadErr);
    return NextResponse.json({ error: uploadErr.message }, { status: 400 });
  }

  const { data: urlData } = sb.storage.from(bucket).getPublicUrl(filePath);
  const publicUrl = urlData?.publicUrl || "";

  // Try to link the uploaded URL onto the merchant record (owner or admin only)
  if (publicUrl && bucket === "store-photos") {
    try {
      const merchantId = parts.length >= 2 && isUuid(parts[1]) ? parts[1] : (parts.length >= 1 && isUuid(parts[0]) ? parts[0] : "");
      if (merchantId && (actor.kind === "admin" || actor.kind === "user")) {
        if (actor.kind === "user") {
          const access = await resolveMerchantWriteAccess(sb, merchantId, actor.id);
          if (!access.ok) return NextResponse.json({ url: publicUrl });
        }
        const { error: updErr } = await sb.from("merchants").update({ logo_url: publicUrl }).eq("id", merchantId);
        if (updErr) console.log("Could not update merchants.logo_url:", updErr.message);
      }
    } catch (e) {
      console.error("DB update after upload:", e);
    }
  }

  return NextResponse.json({ url: publicUrl });
}