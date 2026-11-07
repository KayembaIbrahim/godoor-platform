import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { evaluatePassword, passwordError } from "@/lib/password-strength";
import {
  checkCode,
  listResetRequests,
  markRequestUsed,
  redeemResetCode,
} from "@/lib/password-reset-server";

export const runtime = "nodejs";

/**
 * Onboarding password-setup endpoint — the "onboarding password link" flow,
 * separate from password reset.
 *
 * A business or rider was APPROVED on partner_requests but was never asked for
 * a password during onboarding (the approved row existed, no auth account).
 * Admin opens /admin/applications → "Send setup link" and copies a link + code
 * to the user (WhatsApp/SMS). The user opens /setup-login?token=<id>, enters
 * the code, and sets their OWN password here. No Supabase email needed.
 *
 * GET    ?id=<codeId>   → validates state without consuming the code, so the
 *                          page can show who it's for and whether documents
 *                          were uploaded.
 * POST   → { id, code, newPassword, confirmPassword } redeems the one-time
 *          onboarding code (same entropy/tries as reset codes) and sets the
 *          password on the linked auth user, clearing must_change_password.
 *
 * The code record in app_settings carries purpose="onboarding", the
 * partner_requests id, and a documents_uploaded flag flipped by the
 * /api/onboarding-setup/docs call after the first document upload.
 */

const IP_MAX_ATTEMPTS = 12;
const IP_WINDOW_MS = 15 * 60 * 1000;
const ipAttempts = new Map<string, { count: number; windowStart: number }>();

function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

function ipLimited(ip: string): boolean {
  const e = ipAttempts.get(ip);
  if (!e) return false;
  if (e.windowStart + IP_WINDOW_MS < Date.now()) { ipAttempts.delete(ip); return false; }
  return e.count >= IP_MAX_ATTEMPTS;
}
function hitIp(ip: string): void {
  const now = Date.now();
  if (ipAttempts.size >= 5000) ipAttempts.clear();
  const e = ipAttempts.get(ip);
  if (!e || e.windowStart + IP_WINDOW_MS < now) ipAttempts.set(ip, { count: 1, windowStart: now });
  else e.count += 1;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing link id" }, { status: 400 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });

  // Peek the public-safe state without consuming: we read the record
  // directly so we can describe it (name / role / purpose) before redemption.
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", `pwd_reset:${id}`)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "This setup link is no longer valid." }, { status: 404 });
  let rec: any;
  try { rec = JSON.parse((data as { value?: string }).value || ""); }
  catch { return NextResponse.json({ error: "This setup link is no longer valid." }, { status: 404 }); }
  if (!rec || typeof rec.id !== "string") return NextResponse.json({ error: "This setup link is no longer valid." }, { status: 404 });

  // only onboarding links belong here
  if (rec.purpose !== "onboarding") {
    return NextResponse.json(
      { error: "This is a password-reset link — open the reset link we sent instead.", code: "wrong_purpose" },
      { status: 400 },
    );
  }
  if (rec.used_at) return NextResponse.json({ error: "This setup link has already been used. Ask GoDoor for a new one." }, { status: 400 });
  if (rec.revoked_at) return NextResponse.json({ error: "This setup link was revoked. Ask GoDoor for a new one." }, { status: 400 });
  if (new Date(rec.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This setup link has expired. Ask GoDoor for a new one." }, { status: 400 });

  return NextResponse.json({
    ok: true,
    name: rec.name || "",
    role: rec.role || "business",
    email: rec.email || "",
    application_id: rec.application_id || null,
    documents_uploaded: rec.documents_uploaded === true,
    expires_at: rec.expires_at,
  });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ipLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Please ask for a new setup link." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const code = body.code;
  const newPassword = body.newPassword;
  const confirmPassword = body.confirmPassword;

  if (!id || typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Enter the one-time code from your message." }, { status: 400 });
  }
  if (typeof newPassword !== "string" || !newPassword) {
    return NextResponse.json({ error: "Set a password for your login." }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "The two passwords do not match." }, { status: 400 });
  }
  const strength = evaluatePassword(newPassword);
  if (!strength.ok) {
    return NextResponse.json(
      { error: passwordError(newPassword) || "Password is too weak.", requirements: strength.requirements },
      { status: 400 },
    );
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });

  const outcome = await redeemResetCode(sb, id, code);
  if (!outcome.ok) {
    hitIp(ip);
    if ((outcome as any).record && (outcome as any).record.purpose !== "onboarding") {
      return NextResponse.json(
        { error: "This is a password-reset code — use the reset link we sent instead.", reason: "wrong_purpose" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "That setup code is not valid. It may have expired or already been used — please ask GoDoor for a new link.",
        reason: outcome.reason,
        attemptsRemaining: outcome.attemptsRemaining,
      },
      { status: 400 },
    );
  }

  // The record must be an onboarding code — a reset code must never set a
  // password through this endpoint.
  if (outcome.record.purpose !== "onboarding") {
    return NextResponse.json(
      { error: "This is a password-reset code — use the reset link we sent instead.", reason: "wrong_purpose" },
      { status: 400 },
    );
  }

  // Set the user's OWN password and clear the must-change flag so the
  // SetPasswordGate never loops after this.
  try {
    const { data: existing } = await sb.auth.admin.getUserById(outcome.record.user_id);
    const meta = existing?.user?.user_metadata || {};
    const { error } = await sb.auth.admin.updateUserById(outcome.record.user_id, {
      password: newPassword,
      user_metadata: { ...meta, must_change_password: false },
    });
    if (error) {
      return NextResponse.json(
        { error: "We could not set the password. Please ask for a fresh setup link." },
        { status: 500 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "We could not set the password. Please ask for a fresh setup link." },
      { status: 500 },
    );
  }

  // Mark the originating token used via the ticket table so admin sees it resolved.
  try {
    const tickets = await listResetRequests(sb);
    const ticket = tickets.find((t) => t.code_id === id);
    if (ticket) await markRequestUsed(sb, ticket.id).catch(() => {});
  } catch {}

  ipAttempts.delete(ip);
  return NextResponse.json({ ok: true, email: outcome.record.email, role: outcome.record.role });
}
