import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, signSession, verifySession } from "./admin-session";
import { decryptSecret, encryptSecret, sha256Hex, verifyTotp } from "./admin-totp";

export { ADMIN_COOKIE, signSession, verifySession };

/**
 * Server-only admin auth helpers.
 * Passwords are stored hashed (scrypt) in Supabase `admin_settings`.
 * Sessions are signed HMAC tokens in an httpOnly cookie (see admin-session.ts).
 * NOTE: Never import this module from client components.
 */

const DEFAULT_SALT = "godoor-admin-v1";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/** Deterministic default hash (password: ss356) — used only until the owner changes it. */
function defaultAdminHash(): string {
  const hash = scryptSync("ss356", DEFAULT_SALT, 64).toString("hex");
  return `scrypt$${DEFAULT_SALT}$${hash}`;
}

/**
 * Session-only cookie: no maxAge → browser clears it on close.
 * This forces the admin to re-authenticate each time they reopen the browser.
 */
export async function setSessionCookie(res: NextResponse): Promise<void> {
  res.cookies.set(ADMIN_COOKIE, await signSession(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Short-lived cookie that grants the pending 2FA step (never a full session). */
export function setP2faCookie(res: NextResponse, token: string): void {
  res.cookies.set("godoor_admin_p2fa", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
  });
}

export function clearP2faCookie(res: NextResponse): void {
  res.cookies.set("godoor_admin_p2fa", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

const ADMIN_TABLE_SQL = `CREATE TABLE IF NOT EXISTS admin_settings (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL DEFAULT '',
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  totp_secret TEXT,
  recovery_hashes TEXT,
  login_log JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);`;

const ADMIN_COLUMNS_SQL = `ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS recovery_hashes TEXT,
  ADD COLUMN IF NOT EXISTS login_log JSONB;`;

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;

async function ensureAdminTable(sb: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await sb.rpc("exec_sql", { query: ADMIN_TABLE_SQL });
    if (error) return false;
    await sb.rpc("exec_sql", { query: ADMIN_COLUMNS_SQL });
    return true;
  } catch {
    return false;
  }
}

async function getStoredPasswordHash(sb: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await sb.from("admin_settings").select("password_hash").eq("id", "default").maybeSingle();
    if (data && (data.password_hash as string)) return data.password_hash as string;
    return null;
  } catch {
    return null;
  }
}

/** Verifies the admin password against the stored hash (falls back to the default until changed). */
export async function verifyAdminPassword(sb: SupabaseClient, password: string): Promise<boolean> {
  const stored = await getStoredPasswordHash(sb);
  const target = stored || defaultAdminHash();
  const ok = verifyPassword(password, target);
  // First successful login with the default password → persist it so later checks are explicit.
  if (ok && !stored) {
    try {
      await ensureAdminTable(sb);
      await sb.from("admin_settings").upsert({
        id: "default",
        password_hash: defaultAdminHash(),
        updated_at: new Date().toISOString(),
      });
    } catch {}
  }
  return ok;
}

/** Stores a new hashed admin password (auto-creates the table if needed). */
export async function setAdminPassword(sb: SupabaseClient, newPassword: string): Promise<boolean> {
  try {
    await ensureAdminTable(sb);
    const { error } = await sb.from("admin_settings").upsert({
      id: "default",
      password_hash: hashPassword(newPassword),
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * True when the admin is still on the shipped default password
 * (either no hash stored yet, or the stored hash is the default).
 * Used to warn the admin to set a strong password.
 */
export async function isUsingDefaultPassword(sb: SupabaseClient): Promise<boolean> {
  const stored = await getStoredPasswordHash(sb);
  if (!stored) return true;
  try {
    const [scheme, salt, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hashHex) return true;
    const candidate = scryptSync("ss356", salt, 64);
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  } catch {
    return true;
  }
}

/** Persistent brute-force lockout (survives serverless instance resets). */
export async function getLockStatus(sb: SupabaseClient): Promise<{ remainingMs: number; locked: boolean }> {
  try {
    const { data } = await sb.from("admin_settings").select("failed_attempts, locked_until").eq("id", "default").maybeSingle();
    if (!data) return { remainingMs: 0, locked: false };
    const lockedUntil = data.locked_until ? new Date(data.locked_until as string).getTime() : 0;
    const now = Date.now();
    if (lockedUntil > now) return { remainingMs: lockedUntil - now, locked: true };
    return { remainingMs: 0, locked: false };
  } catch {
    return { remainingMs: 0, locked: false };
  }
}

export async function recordFailedAttempt(sb: SupabaseClient): Promise<boolean> {
  try {
    await ensureAdminTable(sb);
    const { data } = await sb.from("admin_settings").select("failed_attempts").eq("id", "default").maybeSingle();
    let count = (data?.failed_attempts as number) || 0;
    count += 1;
    if (count >= MAX_FAILED_ATTEMPTS) {
      await sb.from("admin_settings").upsert({
        id: "default",
        failed_attempts: count,
        locked_until: new Date(Date.now() + LOCK_MS).toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else {
      await sb.from("admin_settings").upsert({
        id: "default",
        failed_attempts: count,
        updated_at: new Date().toISOString(),
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function resetFailedAttempts(sb: SupabaseClient): Promise<void> {
  try {
    await sb.from("admin_settings").upsert({
      id: "default",
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    });
  } catch {}
}

// ─── Two-factor authentication (TOTP) ──────────────────────────────────────

export type SecurityStatus = {
  enabled: boolean;
  usingDefaultPassword: boolean;
};

export async function getSecurityStatus(sb: SupabaseClient): Promise<SecurityStatus> {
  let enabled = false;
  try {
    const { data } = await sb.from("admin_settings").select("totp_secret").eq("id", "default").maybeSingle();
    enabled = Boolean((data as { totp_secret?: string | null } | null)?.totp_secret);
  } catch {}
  return { enabled, usingDefaultPassword: await isUsingDefaultPassword(sb) };
}

/** Decrypted TOTP secret, or null when 2FA is off. */
export async function getTotpSecret(sb: SupabaseClient): Promise<string | null> {
  try {
    await ensureAdminTable(sb);
    const { data } = await sb.from("admin_settings").select("totp_secret").eq("id", "default").maybeSingle();
    const stored = (data as { totp_secret?: string | null } | null)?.totp_secret;
    if (!stored) return null;
    return await decryptSecret(stored);
  } catch {
    return null;
  }
}

export async function saveTotpSecret(sb: SupabaseClient, secret: string): Promise<boolean> {
  try {
    await ensureAdminTable(sb);
    const { error } = await sb.from("admin_settings").upsert({
      id: "default",
      totp_secret: await encryptSecret(secret),
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export async function clearTotpSecret(sb: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await sb.from("admin_settings").update({
      totp_secret: null,
      recovery_hashes: null,
      updated_at: new Date().toISOString(),
    }).eq("id", "default");
    return !error;
  } catch {
    return false;
  }
}

export async function saveRecoveryHashes(sb: SupabaseClient, hashes: string[]): Promise<boolean> {
  try {
    const { error } = await sb.from("admin_settings").update({
      recovery_hashes: JSON.stringify(hashes),
      updated_at: new Date().toISOString(),
    }).eq("id", "default");
    return !error;
  } catch {
    return false;
  }
}

/** True when `code` is a valid, unused recovery code (consumed on success). */
export async function consumeRecoveryCode(sb: SupabaseClient, code: string): Promise<boolean> {
  const clean = code.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 8) return false;
  try {
    const { data } = await sb.from("admin_settings").select("recovery_hashes").eq("id", "default").maybeSingle();
    const hashes = JSON.parse((data as { recovery_hashes?: string } | null)?.recovery_hashes || "[]") as string[];
    if (!Array.isArray(hashes) || hashes.length === 0) return false;
    const hash = await sha256Hex(clean);
    const idx = hashes.findIndex((h) => h === hash);
    if (idx === -1) return false;
    hashes.splice(idx, 1);
    await saveRecoveryHashes(sb, hashes);
    return true;
  } catch {
    return false;
  }
}

/** Complete the 2FA step: accept an authenticator code or a recovery code. */
export async function verifySecondFactor(sb: SupabaseClient, input: string): Promise<boolean> {
  const secret = await getTotpSecret(sb);
  if (secret) {
    if (await verifyTotp(secret, input)) return true;
    return await consumeRecoveryCode(sb, input);
  }
  return false;
}

// ─── Login audit log ───────────────────────────────────────────────────────

export async function recordAdminLogin(sb: SupabaseClient, ip: string, ok: boolean): Promise<void> {
  try {
    await ensureAdminTable(sb);
    const { data } = await sb.from("admin_settings").select("login_log").eq("id", "default").maybeSingle();
    const log = Array.isArray((data as { login_log?: unknown } | null)?.login_log)
      ? (data as { login_log: { t: string; ip: string; ok: boolean }[] }).login_log
      : [];
    log.push({ t: new Date().toISOString(), ip, ok });
    const trimmed = log.slice(-40);
    await sb.from("admin_settings").update({ login_log: JSON.stringify(trimmed) }).eq("id", "default");
  } catch {}
}

export type LoginEvent = { t: string; ip: string; ok: boolean };

export async function getLoginLog(sb: SupabaseClient): Promise<LoginEvent[]> {
  try {
    const { data } = await sb.from("admin_settings").select("login_log").eq("id", "default").maybeSingle();
    const log = (data as { login_log?: unknown } | null)?.login_log;
    return Array.isArray(log) ? (log as LoginEvent[]) : [];
  } catch {
    return [];
  }
}
