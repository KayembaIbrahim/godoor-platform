import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import {
  ADMIN_COOKIE, clearP2faCookie, clearSessionCookie, getLockStatus, getSecurityStatus,
  recordAdminLogin, recordFailedAttempt, resetFailedAttempts,
  setP2faCookie, setSessionCookie, verifyAdminPassword, verifySecondFactor, verifySession,
} from "@/lib/admin-auth";
import { signPending2fa, verifyPending2fa } from "@/lib/admin-session";

// Lightweight brute-force guard (best-effort on serverless — resets per instance).
const attempts = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();
const MAX_IP_ATTEMPTS = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

function ipLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil > now) return true;
  if (entry.windowStart + IP_WINDOW_MS < now) {
    attempts.delete(ip);
    return false;
  }
  return entry.count > MAX_IP_ATTEMPTS;
}

function hitIpLimit(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.windowStart + IP_WINDOW_MS < now) {
    attempts.set(ip, { count: 1, windowStart: now, lockedUntil: 0 });
  } else {
    entry.count += 1;
    if (entry.count > MAX_IP_ATTEMPTS) entry.lockedUntil = now + 60 * 60 * 1000;
    attempts.set(ip, entry);
  }
}

function clearIpLimit(ip: string) {
  attempts.delete(ip);
}

/** GET /api/admin/auth → session check */
export async function GET() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  const authorized = await verifySession(token);
  if (!authorized) {
    return NextResponse.json({ authorized: false }, { status: 401 });
  }
  const sb = getServiceClient();
  let security = { enabled: false, usingDefaultPassword: true };
  if (sb) security = await getSecurityStatus(sb);
  return NextResponse.json({ authorized: true, ...security }, { status: 200 });
}

/** POST /api/admin/auth → two-step login: password → (optional) TOTP code */
export async function POST(req: Request) {
  const sb = getServiceClient();
  const body = await req.json().catch(() => ({}));
  const ip = clientIp(req);
  if (!sb) {
    return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });
  }

  const { password, code } = body as { password?: string; code?: string };

  // Step 2 (2FA): the password was already verified moments ago and a short-lived
  // pending grant cookie was issued. Only a valid code + valid grant → session.
  if (code !== undefined) {
    const jar = await cookies();
    const pending = jar.get("godoor_admin_p2fa")?.value || "";
    if (!(await verifyPending2fa(pending))) {
      return NextResponse.json({ error: "Login session expired. Re-enter your password." }, { status: 401 });
    }
    const lock = await getLockStatus(sb);
    if (lock.locked) return NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429 });
    const ok = await verifySecondFactor(sb, code);
    if (ok) {
      clearIpLimit(ip);
      await resetFailedAttempts(sb);
      await recordAdminLogin(sb, ip, true);
      const res = NextResponse.json({ ok: true, need2fa: false });
      clearP2faCookie(res);
      await setSessionCookie(res);
      return res;
    }
    await recordFailedAttempt(sb);
    await recordAdminLogin(sb, ip, false);
    return NextResponse.json({ error: "Invalid security code" }, { status: 401 });
  }

  // Step 1 (password)
  if (!password || typeof password !== "string" || !password.trim()) {
    return NextResponse.json({ error: "Enter the admin password" }, { status: 400 });
  }
  if (ipLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts from this address. Blocked for an hour." }, { status: 429 });
  }
  const lock = await getLockStatus(sb);
  if (lock.locked) {
    const mins = Math.max(1, Math.ceil(lock.remainingMs / 60000));
    return NextResponse.json({ error: `Too many failed attempts. Locked for ${mins} more minute${mins === 1 ? "" : "s"}.` }, { status: 429 });
  }
  const ok = await verifyAdminPassword(sb, password);
  if (!ok) {
    hitIpLimit(ip);
    await recordFailedAttempt(sb);
    await recordAdminLogin(sb, ip, false);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const security = await getSecurityStatus(sb);
  if (security.enabled) {
    // Issue the temporary grant — the real session only on the code step.
    const res = NextResponse.json({ ok: true, need2fa: true });
    setP2faCookie(res, await signPending2fa());
    return res;
  }

  clearIpLimit(ip);
  await resetFailedAttempts(sb);
  await recordAdminLogin(sb, ip, true);
  const res = NextResponse.json({ ok: true, need2fa: false, usingDefaultPassword: security.usingDefaultPassword });
  await setSessionCookie(res);
  return res;
}

/** DELETE /api/admin/auth → logout */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  clearP2faCookie(res);
  return res;
}