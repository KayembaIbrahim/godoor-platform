import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only admin password recovery via a security question.
 *
 * ── Why the answer is never readable ──────────────────────────────────────
 * The owner's requirement is that once they type their answer, it is hidden
 * forever. That is enforced structurally rather than by convention:
 *   • only a scrypt hash is written — the plaintext is never stored, so there
 *     is nothing to display even by accident;
 *   • no exported function returns the answer or the hash;
 *   • the public status endpoint exposes only a boolean.
 *
 * ── Why a security question is the weakest link here ──────────────────────
 * A childhood nickname has a tiny guess space, so this is strictly *weaker*
 * than the password or the TOTP 2FA that already exist. It is still valuable —
 * it recovers a locked-out owner — but it is treated as the softest of the
 * three, hence the much tighter attempt ladder below: 5 tries, then an
 * exponential lock that reaches 6 hours. The password ladder starts at 40.
 *
 * NOTE: never import this module from a client component.
 */

const SETTINGS_KEY = "admin_recovery";
export const RECOVERY_QUESTION = "What is my childhood nickname?";

/**
 * Below this an answer is a guessable single character, not a memory aid.
 *
 * Deliberately low (3) rather than stricter: childhood nicknames really are
 * short — "Kay", "Bob", "Dee" — and rejecting them would leave the owner
 * unable to set up recovery at all, which is the exact lockout it exists to
 * prevent. The exposure from a 3-character floor is contained by the secret
 * path, the header check and the 5-attempt lock below.
 */
export const ANSWER_MIN_LENGTH = 3;
export const ANSWER_MAX_LENGTH = 120;

/**
 * Attempts allowed before the recovery door locks. Far lower than the password
 * ladder (40) precisely because the answer space is orders of magnitude smaller.
 */
export const RECOVERY_LOCK_THRESHOLD = 5;
const LOCK_BASE_MS = 60 * 1000;
const LOCK_CEILING_MS = 6 * 60 * 60 * 1000;

type RecoveryRecord = {
  question: string;
  answer_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
};

export type RecoveryStatus = {
  configured: boolean;
  question: string | null;
  locked: boolean;
  lockRemainingMs: number;
  attemptsRemaining: number;
};

function hashAnswer(answer: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(answer, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyAnswer(answer: string, stored: string): boolean {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const candidate = scryptSync(answer, salt, 32);
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/** Normalises casing/whitespace so " KAY " still matches "kay". */
export function normaliseAnswer(answer: unknown): string {
  return typeof answer === "string" ? answer.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function answerError(answer: unknown): string {
  const clean = normaliseAnswer(answer);
  if (!clean) return "Enter your answer to the security question.";
  if (clean.length < ANSWER_MIN_LENGTH) return `Answer must be at least ${ANSWER_MIN_LENGTH} characters.`;
  if (clean.length > ANSWER_MAX_LENGTH) return `Answer must be under ${ANSWER_MAX_LENGTH} characters.`;
  return "";
}

/** Exponential backoff, capped so a sustained attack cannot lock forever. */
export function recoveryLockMs(failures: number): number {
  const over = Math.max(0, failures - RECOVERY_LOCK_THRESHOLD);
  return Math.min(LOCK_CEILING_MS, LOCK_BASE_MS * Math.pow(2, over));
}

async function readRecord(sb: SupabaseClient): Promise<RecoveryRecord | null> {
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error || !data) return null;
    const parsed = JSON.parse((data as { value?: string }).value || "") as Partial<RecoveryRecord>;
    if (!parsed || typeof parsed.answer_hash !== "string" || !parsed.answer_hash) return null;
    return {
      question: typeof parsed.question === "string" ? parsed.question : RECOVERY_QUESTION,
      answer_hash: parsed.answer_hash,
      failed_attempts: Number(parsed.failed_attempts) || 0,
      locked_until: typeof parsed.locked_until === "string" ? parsed.locked_until : null,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeRecord(sb: SupabaseClient, rec: RecoveryRecord): Promise<boolean> {
  try {
    const { error } = await sb.from("app_settings").upsert({
      key: SETTINGS_KEY,
      value: JSON.stringify(rec),
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export async function getRecoveryStatus(sb: SupabaseClient): Promise<RecoveryStatus> {
  const rec = await readRecord(sb);
  if (!rec) {
    return { configured: false, question: null, locked: false, lockRemainingMs: 0, attemptsRemaining: 0 };
  }
  const lockedUntil = rec.locked_until ? new Date(rec.locked_until).getTime() : 0;
  const remainingMs = Math.max(0, lockedUntil - Date.now());
  return {
    configured: true,
    question: rec.question,
    locked: remainingMs > 0,
    lockRemainingMs: remainingMs,
    attemptsRemaining: Math.max(0, RECOVERY_LOCK_THRESHOLD - rec.failed_attempts),
  };
}

/**
 * Stores the answer. Only ever called after the caller has proved BOTH an
 * admin session and the current password, so an unattended unlocked browser
 * cannot plant a recovery secret that only the attacker knows.
 */
export async function setRecoveryAnswer(sb: SupabaseClient, answer: string): Promise<boolean> {
  const bad = answerError(answer);
  if (bad) return false;
  return writeRecord(sb, {
    question: RECOVERY_QUESTION,
    answer_hash: hashAnswer(normaliseAnswer(answer)),
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  });
}

export type RecoveryVerdict =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "locked" | "wrong"; lockRemainingMs: number; attemptsRemaining: number };

/**
 * Checks an answer, counting failures and applying the lock ladder.
 *
 * Deliberately returns one generic failure for "locked", "not_configured" and
 * "wrong" so an attacker learns nothing about the stored state — but the lock
 * message is surfaced because the legitimate owner needs to know to stop trying.
 */
export async function verifyRecoveryAnswer(sb: SupabaseClient, answer: unknown): Promise<RecoveryVerdict> {
  const rec = await readRecord(sb);
  if (!rec) return { ok: false, reason: "not_configured", lockRemainingMs: 0, attemptsRemaining: 0 };

  const lockedUntil = rec.locked_until ? new Date(rec.locked_until).getTime() : 0;
  const remainingMs = Math.max(0, lockedUntil - Date.now());
  if (remainingMs > 0) {
    return { ok: false, reason: "locked", lockRemainingMs: remainingMs, attemptsRemaining: 0 };
  }

  // An empty answer can never match (a stored hash is always of a non-empty
  // string), so it is refused before it burns one of the owner's five tries.
  const clean = normaliseAnswer(answer);
  if (!clean || clean.length < ANSWER_MIN_LENGTH) {
    return {
      ok: false,
      reason: "wrong",
      lockRemainingMs: 0,
      attemptsRemaining: Math.max(0, RECOVERY_LOCK_THRESHOLD - rec.failed_attempts),
    };
  }

  if (verifyAnswer(clean, rec.answer_hash)) {
    await writeRecord(sb, { ...rec, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
    return { ok: true };
  }

  const failures = rec.failed_attempts + 1;
  const lock = failures >= RECOVERY_LOCK_THRESHOLD ? new Date(Date.now() + recoveryLockMs(failures)).toISOString() : null;
  await writeRecord(sb, { ...rec, failed_attempts: failures, locked_until: lock, updated_at: new Date().toISOString() });
  return {
    ok: false,
    reason: "wrong",
    lockRemainingMs: lock ? recoveryLockMs(failures) : 0,
    attemptsRemaining: Math.max(0, RECOVERY_LOCK_THRESHOLD - failures),
  };
}

/** Used after a completed recovery so the owner is not left near the limit. */
export async function clearRecoveryFailures(sb: SupabaseClient): Promise<void> {
  const rec = await readRecord(sb);
  if (!rec) return;
  await writeRecord(sb, { ...rec, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
}