import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";
import { normalizeMorseTag, MORSE_TAG_RE } from "@/lib/morse";
import { isUuid } from "@/lib/api-auth";

/**
 * POST /api/morse/merchant — the business confirms its fixed Morse handle.
 *
 * A business Morse tag is identity, just like the business name: it is set
 * ONCE and never changed by the business. Every Morse payment lands on that
 * fixed tag (customer sends USD there, or the business requests payment from
 * the customer's own Morse tag), so there is never ambiguity about which
 * wallet an order was paid into — which is what makes disputes resolvable.
 *
 * A tag is globally unique in Morse: it cannot be used by another GoDoor
 * account or another business. The owner's own personal Morse tag is allowed
 * (same person, same wallet).
 */
const MerchantTagSchema = z.object({
  merchantId: z.string(),
  tag: z.string().trim().min(3).max(32),
  contactPhone: z.string().trim().max(32).optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = MerchantTagSchema.safeParse(body);
  if (!parsed.success || !isUuid(parsed.data.merchantId)) {
    return NextResponse.json({ error: "Invalid business or morse tag — use letters, numbers or underscores (3–32 characters)." }, { status: 400 });
  }

  const tag = normalizeMorseTag(parsed.data.tag);
  if (!MORSE_TAG_RE.test(tag)) {
    return NextResponse.json({ error: "Invalid morse tag — use letters, numbers or underscores (3–32 characters)." }, { status: 400 });
  }

  // Owner check
  const { data: merchant, error: mErr } = await sb
    .from("merchants")
    .select("id, owner_id, name, morse_tag")
    .eq("id", parsed.data.merchantId)
    .maybeSingle();
  if (mErr || !merchant) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (merchant.owner_id !== actor.id) {
    return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
  }

  // Fixed identity — set once. Re-confirming the same tag is a no-op; a
  // different tag is only possible through a support-approved change request.
  const current = String(merchant.morse_tag || "").trim();
  if (current) {
    if (normalizeMorseTag(current) === tag) {
      return NextResponse.json({ ok: true, morseTag: current, unchanged: true });
    }
    const clashP = await sb.from("profiles").select("id").ilike("morse_tag", tag).neq("id", actor.id).maybeSingle();
    if (clashP.data) {
      return NextResponse.json(
        { ok: false, taken: true, error: `Tag ${tag} already belongs to another GoDoor account.` },
        { status: 409 },
      );
    }
    const clashM = await sb.from("merchants").select("id").ilike("morse_tag", tag).neq("id", parsed.data.merchantId).maybeSingle();
    if (clashM.data) {
      return NextResponse.json(
        { ok: false, taken: true, error: `Tag ${tag} is already used by another business on GoDoor.` },
        { status: 409 },
      );
    }
    const CREATE_SQL = `CREATE TABLE IF NOT EXISTS morse_tag_change_requests (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_email TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      user_role TEXT NOT NULL DEFAULT 'customer',
      kind TEXT NOT NULL DEFAULT 'profile',
      merchant_id TEXT NOT NULL DEFAULT '',
      merchant_name TEXT NOT NULL DEFAULT '',
      current_tag TEXT NOT NULL DEFAULT '',
      requested_tag TEXT NOT NULL,
      contact_phone TEXT NOT NULL DEFAULT '',
      contact_channel TEXT NOT NULL DEFAULT 'email',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );`;
    try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
    try {
      const { data: existing } = await sb
        .from("morse_tag_change_requests")
        .select("id")
        .eq("user_id", actor.id)
        .eq("kind", "merchant")
        .eq("status", "pending")
        .ilike("requested_tag", tag)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { ok: false, locked: true, morseTag: current, changeSubmitted: true, error: "Your business Morse tag is fixed — a change request for this tag is already with our support team." },
          { status: 409 },
        );
      }
      const contactPhone = String(parsed.data.contactPhone || "").trim();
      const { data: row, error: insErr } = await sb.from("morse_tag_change_requests").insert({
        user_id: actor.id,
        user_email: actor.email || "",
        user_name: String(merchant.name || ""),
        user_role: typeof actor.role === "string" ? actor.role : "customer",
        kind: "merchant",
        merchant_id: parsed.data.merchantId,
        merchant_name: String(merchant.name || "Business"),
        current_tag: current,
        requested_tag: tag,
        contact_phone: contactPhone,
        contact_channel: contactPhone ? "phone" : "email",
        reason: parsed.data.reason || "",
        status: "pending",
      }).select().single();
      if (insErr) throw insErr;
      return NextResponse.json({
        ok: false, locked: true, morseTag: current, changeSubmitted: true, requestId: row.id,
        error: "Your business Morse tag is fixed for safety. A change request has been sent — our support team will contact you to approve it before it goes live.",
      }, { status: 409 });
    } catch {
      return NextResponse.json(
        { ok: false, locked: true, morseTag: current, error: "Your business Morse tag is fixed and cannot be changed here. Contact support if you genuinely need a new one." },
        { status: 409 },
      );
    }
  }

  // Global uniqueness. Another person's profile tag counts (Morse usernames
  // are unique); the owner's own personal tag is the same human → allowed.
  const { data: profileClash } = await sb
    .from("profiles")
    .select("id")
    .ilike("morse_tag", tag)
    .maybeSingle();
  if (profileClash && String(profileClash.id) !== actor.id) {
    return NextResponse.json(
      { ok: false, taken: true, error: `Tag ${tag} already belongs to another GoDoor account. Use the business's own Morse username.` },
      { status: 409 },
    );
  }
  const { data: merchantClash } = await sb
    .from("merchants")
    .select("id")
    .ilike("morse_tag", tag)
    .neq("id", parsed.data.merchantId)
    .maybeSingle();
  if (merchantClash) {
    return NextResponse.json(
      { ok: false, taken: true, error: `Tag ${tag} is already used by another business on GoDoor.` },
      { status: 409 },
    );
  }

  const { error: updErr } = await sb
    .from("merchants")
    .update({ morse_tag: tag, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.merchantId);
  if (updErr) {
    return NextResponse.json({ error: "Could not save the morse tag. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, morseTag: tag });
}