import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { evaluatePassword, passwordError } from "@/lib/password-strength";
import { redeemResetCode } from "@/lib/password-reset-server";

export const runtime = "nodejs";

/**
 * Redeems a one-time reset code and sets a new password.
 *
 * This route is PUBLIC — it is reached from the link the admin sent to the
 * user, who by definition cannot sign in. It is NOT under /api/admin/, so the
 * proxy's admin gate does not apply to it.
 *
 * ── What protects it ────────────────────────────────────────────────────────
 * 1. The code itself: 8 characters from a 32-letter alphabet = 40 bits. A
 *    search over the whole space is not a thing an attacker can do over HTTP.
 * 2. A per-IP attempt ladder, so a scripted guess is throttled even so.
 * 3. The code's own attempt counter (in the database), which survives a
 *    serverless restart and a change of IP — 5 wrong guesses destroys the
 *    code for good.
 * 4. Expiry: a code is dead after 24 hours.
 * 5. One-time use: the code is marked used before the password is set.
 *
 * The responses are deliberately uniform. A caller learns only "that code did
 * not work" — not whether it was wrong, expired, already used or revoked,
 * because those distinctions would let an attacker probe the state of codes
 * they did not create.
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
  if (e.windowStart + IP_WINDOW_MS < Date.now()) {
    ipAttempts.delete(ip);
    return false;
  }
  return e.count >= IP_MAX_ATTEMPTS;
}

function hitIp(ip: string): void {
  const now = Date.now();
  if (ipAttempts.size >= 5000) ipAttempts.clear();
  const e = ipAttempts.get(ip);
  if (!e || e.windowStart + IP_WINDOW_MS < now) ipAttempts.set(ip, { count: 1, windowStart: now });
  else e.count += 1;
}

/**
 * Sets the new password for the account behind a redeemed code.
 *
 * `must_change_password` is cleared at the same time: the flag exists to
 * force a change away from the temporary password the OLD admin flow issued.
 * Here the user has chosen their own password, so the flag would only make
 * the app ask them to change it again for no reason.
 */
async function applyNewPassword(userId: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, error: "Server auth is not configured" };

  const { data: existing } = await sb.auth.admin.getUserById(userId);
  const meta = existing?.user?.user_metadata || {};
  const { error } = await sb.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { ...meta, must_change_password: false },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ipLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Please ask for a new reset code." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const code = body.code;
  const newPassword = body.newPassword;
  const confirmPassword = body.confirmPassword;

  if (!id || typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Enter the reset code from your message." }, { status: 400 });
  }
  if (typeof newPassword !== "string" || !newPassword) {
    return NextResponse.json({ error: "Choose a new password." }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "New password and confirmation do not match." }, { status: 400 });
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
    // One uniform message for every failure mode.
    return NextResponse.json(
      {
        error: "That reset code is not valid. It may have expired or already been used — please ask for a new one.",
        reason: outcome.reason,
        attemptsRemaining: outcome.attemptsRemaining,
      },
      { status: 400 },
    );
  }

  const applied = await applyNewPassword(outcome.record.user_id, newPassword);
  if (!applied.ok) {
    // The code is already spent, so the user must ask for another one. Say so
    // plainly rather than leaving them to wonder why their new password
    // "did not work".
    return NextResponse.json(
      { error: "We could not apply the new password. Please ask for a fresh reset code." },
      { status: 500 },
    );
  }

  ipAttempts.delete(ip);
  return NextResponse.json({ ok: true, email: outcome.record.email });
}
