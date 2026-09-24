import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";
import { normalizeMorseTag, MORSE_TAG_RE } from "@/lib/morse";

/**
 * POST /api/morse/tag — signed-in users confirm their unique Morse username.
 *
 * Safety model (per platform policy):
 *   - a tag is set ONCE; the account owner can never silently change it;
 *   - changing a confirmed tag submits a change request that goes to support
 *     (they contact the user before it is approved) — see /api/morse/change-request;
 *   - a tag already owned by another GoDoor account or business is rejected.
 */
const TagSchema = z.object({
  tag: z.string().trim().min(3).max(32),
  contactPhone: z.string().trim().max(32).optional(),
  reason: z.string().trim().max(500).optional(),
});

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
  const parsed = TagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid morse tag — use letters, numbers or underscores (3–32 characters)." }, { status: 400 });
  }

  const tag = normalizeMorseTag(parsed.data.tag);
  if (!MORSE_TAG_RE.test(tag)) {
    return NextResponse.json({ error: "Invalid morse tag — use letters, numbers or underscores (3–32 characters)." }, { status: 400 });
  }

  // Uniqueness is safety-critical: a Morse username can never belong to two
  // GoDoor accounts, and it can never be stolen from another business either.
  const { data: clash } = await sb
    .from("profiles")
    .select("id")
    .ilike("morse_tag", tag)
    .maybeSingle();
  if (clash && String(clash.id) !== actor.id) {
    return NextResponse.json(
      { ok: false, taken: true, error: `Invalid morse tag — ${tag} already belongs to another GoDoor account.` },
      { status: 409 },
    );
  }
  const { data: mc } = await sb
    .from("merchants")
    .select("id")
    .ilike("morse_tag", tag)
    .neq("owner_id", actor.id)
    .maybeSingle();
  if (mc) {
    return NextResponse.json(
      { ok: false, taken: true, error: `Invalid morse tag — ${tag} is already used by a business on GoDoor.` },
      { status: 409 },
    );
  }

  // Set-once rule: profiles.morse_tag is the single source of truth.
  const { data: prof } = await sb.from("profiles").select("morse_tag, name, email, phone").eq("id", actor.id).maybeSingle();
  const current = String(prof?.morse_tag || "").trim();

  if (current && normalizeMorseTag(current) === tag) {
    // Same tag re-confirmed → no-op, already live.
    return NextResponse.json({ ok: true, tag, unchanged: true });
  }

  if (current) {
    // A confirmed tag is fixed. Any further change must be approved manually.
    try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
    try {
      const { data: existing } = await sb
        .from("morse_tag_change_requests")
        .select("id")
        .eq("user_id", actor.id)
        .eq("status", "pending")
        .ilike("requested_tag", tag)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { ok: false, locked: true, currentTag: current, changeSubmitted: true, error: "Your Morse tag is fixed — a change request for this tag is already with our support team." },
          { status: 409 },
        );
      }
      const contactPhone = String(parsed.data.contactPhone || prof?.phone || "").trim();
      const { data, error } = await sb.from("morse_tag_change_requests").insert({
        user_id: actor.id,
        user_email: actor.email || String(prof?.email || ""),
        user_name: String(prof?.name || ""),
        user_role: typeof actor.role === "string" ? actor.role : "customer",
        kind: "profile",
        current_tag: current,
        requested_tag: tag,
        contact_phone: contactPhone,
        contact_channel: contactPhone ? "phone" : "email",
        reason: parsed.data.reason || "",
        status: "pending",
      }).select().single();
      if (error) throw error;
      return NextResponse.json({
        ok: false, locked: true, currentTag: current, changeSubmitted: true, requestId: data.id,
        error: "Your Morse tag is fixed for safety. A change request has been sent — our support team will contact you to approve it before it goes live.",
      }, { status: 409 });
    } catch {
      return NextResponse.json(
        { ok: false, locked: true, currentTag: current, error: "Your Morse tag is fixed and cannot be changed here. Contact support if you genuinely need a new one." },
        { status: 409 },
      );
    }
  }

  // First-time set: persist to profiles, mirror into auth metadata.
  const { error: upsertErr } = await sb.from("profiles").upsert(
    { id: actor.id, email: actor.email, morse_tag: tag, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (upsertErr) {
    return NextResponse.json({ error: "Could not save your morse tag. Try again." }, { status: 500 });
  }

  try {
    const { data: user } = await sb.auth.admin.getUserById(actor.id);
    const meta = user?.user?.user_metadata || {};
    await sb.auth.admin.updateUserById(actor.id, { user_metadata: { ...meta, morse_tag: tag } });
  } catch {}

  return NextResponse.json({ ok: true, tag });
}