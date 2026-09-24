import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser, isAdminCookieValid } from "@/lib/api-auth";

import { getServiceClient } from "@/lib/supabase-server";
import { normalizeMorseTag, MORSE_TAG_RE } from "@/lib/morse";

/**
 * Morse tag change requests.
 *
 * Every GoDoor account confirms its Morse tag ONCE. From then on the tag is
 * fixed — changing it is only possible through this approval flow:
 *
 *   POST  /api/morse/change-request { requestedTag, kind?, merchantId?, contactPhone?, reason? }
 *         A signed-in user submits their new tag + contact info. A pending
 *         request goes to the admin portal and support reaches the user to
 *         verify before it is applied.
 *   GET   /api/morse/change-request?mine=true            → the user's own requests
 *         /api/morse/change-request?kind=&status=        → admin review queue (cookie)
 *   PATCH /api/morse/change-request { id, status: "approved"|"rejected", admin_note? }
 *         Admin (cookie) approves/rejects. On approval the tag from the ROW is
 *         applied (never a client-supplied value), after a uniqueness re-check.
 *
 * The safety rules are hard requirements:
 *   - a tag can be set once per account;
 *   - any change request is reviewed by support before it goes live;
 *   - an already-used tag is never allowed on a second account or business.
 */
type Ctx = NonNullable<ReturnType<typeof getServiceClient>>;

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
);
CREATE INDEX IF NOT EXISTS mcr_user_idx ON morse_tag_change_requests (user_id);
CREATE INDEX IF NOT EXISTS mcr_status_idx ON morse_tag_change_requests (status, created_at DESC);`;

async function ensureTable(sb: Ctx) {
  try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
}

const PostSchema = z.object({
  requestedTag: z.string().trim().min(3).max(32),
  kind: z.enum(["profile", "merchant"]).default("profile"),
  merchantId: z.string().optional(),
  contactPhone: z.string().trim().max(32).optional(),
  reason: z.string().trim().max(500).optional(),
});

async function getProfile(sb: Ctx, userId: string) {
  const { data } = await sb.from("profiles").select("morse_tag, name, phone").eq("id", userId).maybeSingle();
  return data as { morse_tag?: string | null; name?: string | null; phone?: string | null } | null;
}

async function tagInUseElsewhere(sb: Ctx, tag: string, ignoreUserId: string, ignoreMerchantId?: string): Promise<string | null> {
  const clean = normalizeMorseTag(tag);
  const { data: pc } = await sb.from("profiles").select("id").ilike("morse_tag", clean).neq("id", ignoreUserId).maybeSingle();
  if (pc) return `Tag @${clean} already belongs to another GoDoor account.`;
  let q = sb.from("merchants").select("id").ilike("morse_tag", clean);
  if (ignoreMerchantId) q = q.neq("id", ignoreMerchantId);
  else q = q.neq("owner_id", ignoreUserId); // the user's own merchant tag = same human
  const { data: mc } = await q.maybeSingle();
  if (mc) return `Tag @${clean} is already used by another business on GoDoor.`;
  return null;
}

export async function POST(req: NextRequest) {
  const actor = await getApiUser(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  await ensureTable(sb);

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid requestedTag required — letters, numbers or underscores (3–32)." }, { status: 400 });
  }
  const tag = normalizeMorseTag(parsed.data.requestedTag);
  if (!MORSE_TAG_RE.test(tag)) {
    return NextResponse.json({ error: "Invalid morse tag — letters, numbers or underscores (3–32)." }, { status: 400 });
  }

  let currentTag = "";
  let user_name = "";
  let merchantId = "";
  let merchantName = "";

  if (parsed.data.kind === "merchant") {
    const mid = parsed.data.merchantId;
    if (!mid) return NextResponse.json({ error: "merchantId required for a business tag change" }, { status: 400 });
    const { data: m } = await sb.from("merchants").select("id, owner_id, name, morse_tag").eq("id", mid).maybeSingle();
    if (!m) return NextResponse.json({ error: "Business not found" }, { status: 404 });
    if (m.owner_id !== actor.id) return NextResponse.json({ error: "You do not own this business." }, { status: 403 });
    currentTag = String(m.morse_tag || "").trim();
    merchantId = String(m.id);
    merchantName = String(m.name || "Business");
    user_name = String(m.name || "");
  } else {
    const prof = await getProfile(sb, actor.id);
    currentTag = String(prof?.morse_tag || "").trim();
    user_name = String(prof?.name || "");
  }

  if (!currentTag) {
    return NextResponse.json({ error: { message: "Confirm your first Morse tag before requesting a change." } }, { status: 409 });
  }
  if (currentTag === tag) {
    return NextResponse.json({ ok: true, tag, unchanged: true, error: null });
  }

  // Safety: never let a second account own a tag that is already in use.
  const clash = await tagInUseElsewhere(sb, tag, actor.id, merchantId || undefined);
  if (clash) return NextResponse.json({ error: { message: clash } }, { status: 409 });

  const { data: existing } = await sb
    .from("morse_tag_change_requests")
    .select("id")
    .eq("user_id", actor.id)
    .eq("status", "pending")
    .ilike("requested_tag", tag)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: { message: "You already have a pending Morse tag change request for this tag. Our team will reach out to approve it." } }, { status: 409 });
  }

  const contactPhone = String(parsed.data.contactPhone || "").trim();
  const channel = contactPhone ? "phone" : "email";

  const { data, error } = await sb.from("morse_tag_change_requests").insert({
    user_id: actor.id,
    user_email: actor.email || "",
    user_name,
    user_role: typeof actor.role === "string" ? actor.role : "customer",
    kind: parsed.data.kind,
    merchant_id: merchantId,
    merchant_name: merchantName,
    current_tag: currentTag,
    requested_tag: tag,
    contact_phone: contactPhone,
    contact_channel: channel,
    reason: parsed.data.reason || "",
    status: "pending",
  }).select().single();

  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 500 });

  return NextResponse.json({
    ok: true,
    submitted: true,
    requestId: data.id,
    currentTag,
    requestedTag: tag,
    contactChannel: channel,
    message:
      "Your Morse tag is fixed for safety. A change request has been sent to our support team — they will contact you to approve it before it goes live.",
  });
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const mine = req.nextUrl.searchParams.get("mine") === "true";
  if (mine) {
    const user = await getApiUser(req);
    if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
    const { data } = await sb
      .from("morse_tag_change_requests")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    return NextResponse.json({ requests: data || [] });
  }

  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let q = sb.from("morse_tag_change_requests").select("*");
  const status = req.nextUrl.searchParams.get("status") || "pending";
  q = q.eq("status", status);
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind) q = q.eq("kind", kind);
  const { data } = await q.order("created_at", { ascending: false }).limit(100);
  return NextResponse.json({ requests: data || [] });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { id, status, admin_note } = body;
  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });
  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "status must be approved or rejected" }, { status: 400 });
  }

  const { data: row } = await sb.from("morse_tag_change_requests").select("*").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (row.status === "approved" || row.status === "rejected") {
    return NextResponse.json({ error: "This request was already reviewed" }, { status: 409 });
  }

  const note = String(admin_note || "");
  const reviewedAt = new Date().toISOString();

  if (status === "approved") {
    const tag = normalizeMorseTag(String(row.requested_tag || ""));
    if (!MORSE_TAG_RE.test(tag)) {
      return NextResponse.json({ error: "Requested tag is no longer valid" }, { status: 409 });
    }
    // Re-check uniqueness at approval time — the tag may have been taken since.
    const clash = await tagInUseElsewhere(sb, tag, String(row.user_id), String(row.merchant_id || "") || undefined);
    if (clash) {
      await sb.from("morse_tag_change_requests").update({
        status: "rejected", admin_note: `${note || "Rejected by admin"}. ${clash}`, reviewed_at: reviewedAt, reviewed_by: "admin",
      }).eq("id", id);
      return NextResponse.json({ error: { message: clash, auto_rejected: true } }, { status: 409 });
    }

    let applyErr: string | null = null;
    if (row.kind === "merchant") {
      const { error } = await sb.from("merchants").update({ morse_tag: tag, updated_at: reviewedAt }).eq("id", row.merchant_id);
      applyErr = error?.message || null;
    } else {
      const { error } = await sb.from("profiles").update({ morse_tag: tag, updated_at: reviewedAt }).eq("id", row.user_id);
      if (!error) {
        try {
          const { data: u } = await sb.auth.admin.getUserById(String(row.user_id));
          const meta = (u?.user?.user_metadata || {}) as Record<string, unknown>;
          await sb.auth.admin.updateUserById(String(row.user_id), { user_metadata: { ...meta, morse_tag: tag } });
        } catch {}
      }
      applyErr = error?.message || null;
    }
    if (applyErr) return NextResponse.json({ error: applyErr }, { status: 500 });
  }

  await sb.from("morse_tag_change_requests").update({
    status, admin_note: note || (status === "approved" ? "Approved by admin" : "Rejected by admin"),
    reviewed_at: reviewedAt, reviewed_by: "admin",
  }).eq("id", id);

  return NextResponse.json({ ok: true, applied: status === "approved" });
}