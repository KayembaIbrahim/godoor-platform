import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { evaluatePassword, passwordError } from "@/lib/password-strength";
import {
  ADMIN_COOKIE, recordAdminLogin, setAdminPassword, verifyAdminPassword, verifySession,
} from "@/lib/admin-auth";
import {
  ANSWER_MIN_LENGTH, RECOVERY_QUESTION, answerError, getRecoveryStatus, normaliseAnswer,
  setRecoveryAnswer, verifyRecoveryAnswer,
} from "@/lib/admin-recovery";

export const runtime = "nodejs";

/**
 * Admin password recovery through a security question.
 *
 * This endpoint is reachable WITHOUT a session — that is the whole point, since
 * it exists for the owner who has been locked out. Everything else under
 * /api/admin/* is 404-blocked by the proxy unless a session cookie is present,
 * so this route (and only this route) is exempted there.
 *
 * Because it is public it carries three independent guards instead of one:
 *   1. the caller must know ADMIN_PATH_SECRET (sent as a header, which the
 *      browser reads from the secret URL they are already on);
 *   2. they must know the security answer;
 *   3. only 5 answer attempts are allowed before an exponential lock.
 *
 * The answer itself is never stored in plaintext and is never returned here.
 */

/** Small per-IP guard for the recovery action only. */
const attempts = new Map<string, { count: number; windowStart: number }>();
const IP_MAX = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;

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
  const e = attempts.get(ip);
  if (!e) return false;
  if (e.windowStart + IP_WINDOW_MS < Date.now()) {
    attempts.delete(ip);
    return false;
  }
  return e.count >= IP_MAX;
}

function hitIp(ip: string): void {
  const now = Date.now();
  if (attempts.size >= 5000) attempts.clear();
  const e = attempts.get(ip);
  if (!e || e.windowStart + IP_WINDOW_MS < now) attempts.set(ip, { count: 1, windowStart: now });
  else e.count += 1;
}

/** Does the caller know the unguessable admin URL? */
function hasSecret(req: Request): boolean {
  const secret = process.env.ADMIN_PATH_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const supplied = req.headers.get("x-godoor-admin-secret") || "";
  return supplied.length > 0 && supplied === secret;
}

async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

/** GET — recovery status.
 *
 * Anonymous callers learn only *whether* recovery is configured (needed so the
 * login gate can decide whether to offer the option). They never learn the
 * question, the answer, the attempt count or the lock state.
 */
export async function GET(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });

  if (!(await hasSession())) {
    const status = await getRecoveryStatus(sb);
    return NextResponse.json({ configured: status.configured }, { status: 200 });
  }

  const status = await getRecoveryStatus(sb);
  return NextResponse.json(
    {
      configured: status.configured,
      question: status.question,
      locked: status.locked,
      lockRemainingMs: status.lockRemainingMs,
      attemptsRemaining: status.attemptsRemaining,
      minLength: ANSWER_MIN_LENGTH,
    },
    { status: 200 },
  );
}

/** POST — `setup` (store the answer) or `recover` (answer it, set a new password). */
export async function POST(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  // ── Setup: store the security answer ─────────────────────────────────────
  if (action === "setup") {
    // Requires BOTH a live session and the current password. Session alone
    // would let anyone at an unattended, already-unlocked browser plant a
    // recovery secret that only they know.
    if (!(await hasSession())) {
      return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
    }
    const current = body.currentPassword;
    if (typeof current !== "string" || !current) {
      return NextResponse.json({ error: "Enter your current admin password." }, { status: 400 });
    }
    if (!(await verifyAdminPassword(sb, current))) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    const answer = body.answer;
    if (normaliseAnswer(answer) !== normaliseAnswer(body.confirmAnswer)) {
      return NextResponse.json({ error: "Answer and confirmation do not match." }, { status: 400 });
    }
    const bad = answerError(answer);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    if (!(await setRecoveryAnswer(sb, answer as string))) {
      return NextResponse.json({ error: "Could not save your answer. Try again." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, question: RECOVERY_QUESTION });
  }

  // ── Recover: verify the answer, then set a brand-new password ────────────
  if (action === "recover") {
    if (!hasSecret(req)) {
      return NextResponse.json({ error: "Recovery link is not valid." }, { status: 404 });
    }
    const ip = clientIp(req);
    if (ipLimited(ip)) {
      return NextResponse.json(
        { error: "Too many recovery attempts from this address. Try again later." },
        { status: 429 },
      );
    }

    const verdict = await verifyRecoveryAnswer(sb, body.answer);
    if (!verdict.ok) {
      hitIp(ip);
      if (verdict.reason === "not_configured") {
        return NextResponse.json(
          { error: "Password recovery has not been set up on this portal." },
          { status: 409 },
        );
      }
      if (verdict.reason === "locked") {
        const mins = Math.max(1, Math.ceil(verdict.lockRemainingMs / 60000));
        return NextResponse.json(
          { error: `Too many wrong answers. Locked for ${mins} more minute${mins === 1 ? "" : "s"}.`, locked: true },
          { status: 429 },
        );
      }
      return NextResponse.json(
        {
          error: "That answer is not correct.",
          attemptsRemaining: verdict.attemptsRemaining,
        },
        { status: 401 },
      );
    }

    // Answer is correct — now the owner must choose a new password.
    const next = body.newPassword;
    if (typeof next !== "string" || !next) {
      return NextResponse.json({ error: "Choose a new password." }, { status: 400 });
    }
    if (next !== body.confirmPassword) {
      return NextResponse.json({ error: "New password and confirmation do not match." }, { status: 400 });
    }
    if (!evaluatePassword(next).ok) {
      return NextResponse.json({ error: passwordError(next) || "Password is too weak" }, { status: 400 });
    }
    if (!(await setAdminPassword(sb, next))) {
      return NextResponse.json({ error: "Could not save the new password. Try again." }, { status: 500 });
    }
    // A reset is security-relevant — leave it in the login audit log.
    await recordAdminLogin(sb, ip, true);
    attempts.delete(ip);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}