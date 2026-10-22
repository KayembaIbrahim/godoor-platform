import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only one-time password-reset codes.
 *
 * ── The flow this implements ────────────────────────────────────────────────
 * A rider (or customer, or business owner) has forgotten their password and
 * phones the platform asking for help. The admin opens the portal, picks the
 * person, and presses "Issue reset code". The portal then hands the admin two
 * things to pass on:
 *
 *   1. a LINK  → https://godoor.site/reset-password?token=<id>
 *   2. a CODE  → e.g. GDR-K7QM-3T9P
 *
 * The admin sends both to the user (WhatsApp, SMS, email — the platform has no
 * outbound mail provider configured, so the relay is manual by design). The
 * user opens the link, types the code, and chooses a new password.
 *
 * ── Why a code AND a link, rather than a link that just works? ─────────────
 * The link alone would be a bearer token: anyone who intercepted the URL could
 * take over the account. Requiring a second factor that travels by a *different
 * channel* (the code, sent separately from the link) means a leaked URL is not
 * enough — the attacker would need both. That is the same two-channel
 * assumption behind the admin portal's own security-question recovery.
 *
 * ── Why the code is hashed at rest ─────────────────────────────────────────
 * The code is stored as a scrypt hash, exactly like the admin password and the
 * wallet PIN in this codebase. A database leak therefore does not hand an
 * attacker a set of live reset codes. The plaintext exists for exactly one
 * moment — the moment the admin is shown it — and is never written down.
 *
 * ── Why `app_settings` and not a dedicated table ───────────────────────────
 * Production has no DDL access from the app (no `exec_sql` RPC), and the
 * codebase already uses `app_settings` as a keyed store for exactly this kind
 * of record (`withdrawal:user:<id>`, `wallet_security:<id>`). One row per
 * code, keyed `pwd_reset:<id>`, means issuing a code is a single insert with
 * no read-modify-write race — two admins issuing codes at the same moment
 * cannot clobber each other.
 *
 * NOTE: never import this module from a client component.
 */

const KEY_PREFIX = "pwd_reset:";

/** How long a code stays redeemable. */
export const RESET_CODE_TTL_HOURS = 24;

/**
 * How many wrong codes are allowed before the code is destroyed outright.
 *
 * The code is 8 characters from a 32-letter alphabet = 40 bits of entropy, so
 * an online guess is already impractical. The ladder is here for the far
 * cheaper case: an admin sends a code, the user mistypes it twice, and the
 * third slip must not destroy a legitimate reset. Five tries covers every
 * realistic typo while still capping a deliberate search at a handful of
 * guesses.
 */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/**
 * A 25-letter alphabet with no ambiguous characters.
 *
 * The code is read out over the phone and typed on a phone keyboard, so every
 * character that can be mistaken for another one is a support call. The pairs
 * that cause trouble are O/0, I/1, I/L, L/1, U/V, B/8, S/5, Z/2, M/N, M/W and
 * V/W — and this alphabet contains at most ONE member of each pair:
 *
 *   • no O, I, L, U or 0/1/2/5/8 at all
 *   • B, S and Z are kept but their digit partners (8, 5, 2) are not
 *   • M and V are dropped so that neither can be read as W
 *
 * 25 characters gives 25^8 ≈ 1.5×10^11 combinations — about 37 bits, which is
 * far beyond anything an online attacker can search, and the per-code attempt
 * ladder in the route handler backs it up.
 */
const CODE_ALPHABET = "ABCDEFGHJKNPQRSTWXYZ34679";

/** The visible shape of a code: GDR-XXXX-XXXX. */
export const CODE_PREFIX = "GDR";

export type ResetCodeStatus = "active" | "used" | "revoked" | "expired";

export type ResetCodeRecord = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  code_hash: string;
  attempts: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  issued_by: string;
};

export type IssuedResetCode = {
  record: ResetCodeRecord;
  /** The plaintext code. Shown ONCE, to the admin, and never stored. */
  code: string;
};

export type ResetCodeListItem = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  status: ResetCodeStatus;
  attempts: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  issued_by: string;
};

function hashCode(code: string, salt: string): string {
  const hash = scryptSync(code, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyCode(code: string, stored: string): boolean {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const candidate = scryptSync(code, salt, 32);
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/** Generates a fresh, human-typeable code. e.g. "GDR-K7QM-3T9P". */
export function generateResetCode(): string {
  const bytes = randomBytes(8);
  let body = "";
  for (let i = 0; i < 8; i++) body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Normalises what a user typed so "gdr k7qm 3t9p" still matches. */
export function normaliseCode(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The canonical form used for hashing and comparison. */
export function canonicalCode(input: unknown): string {
  const clean = normaliseCode(input);
  if (!clean) return "";
  // Strip the "GDR" marker if it was typed, then re-add it, so both
  // "K7QM3T9P" and "GDR-K7QM-3T9P" reduce to the same string.
  const body = clean.startsWith(CODE_PREFIX) ? clean.slice(CODE_PREFIX.length) : clean;
  return `${CODE_PREFIX}${body}`;
}

export function isWellFormedCode(input: unknown): boolean {
  const canon = canonicalCode(input);
  return /^GDR[ABCDEFGHJKMNPQRTVWXY34679]{8}$/.test(canon);
}

function settingsKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** Reads one record. Returns null when it does not exist (or is unreadable). */
async function readRecord(sb: SupabaseClient, id: string): Promise<ResetCodeRecord | null> {
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", settingsKey(id))
      .maybeSingle();
    if (error || !data) return null;
    const parsed = JSON.parse((data as { value?: string }).value || "") as Partial<ResetCodeRecord>;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.user_id !== "string") return null;
    return {
      id: parsed.id,
      user_id: parsed.user_id,
      email: parsed.email || "",
      name: parsed.name || "",
      role: parsed.role || "customer",
      code_hash: parsed.code_hash || "",
      attempts: Number(parsed.attempts) || 0,
      created_at: parsed.created_at || new Date().toISOString(),
      expires_at: parsed.expires_at || new Date().toISOString(),
      used_at: parsed.used_at || null,
      revoked_at: parsed.revoked_at || null,
      issued_by: parsed.issued_by || "admin",
    };
  } catch {
    return null;
  }
}

async function writeRecord(sb: SupabaseClient, rec: ResetCodeRecord): Promise<boolean> {
  try {
    const { error } = await sb.from("app_settings").upsert({
      key: settingsKey(rec.id),
      value: JSON.stringify(rec),
      updated_at: new Date().toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

export type IssueInput = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  issued_by?: string;
  ttl_hours?: number;
};

/**
 * Issues a new code for a user, superseding any code they already hold.
 *
 * Only one live code per person: a second request replaces the first, so the
 * copy the admin already sent out cannot be redeemed after the admin has
 * re-issued. The old row is deleted rather than left to expire, because two
 * live codes for one account doubles the number of things an attacker needs.
 */
export async function issueResetCode(sb: SupabaseClient, input: IssueInput): Promise<IssuedResetCode | null> {
  if (!input.user_id || !input.email) return null;

  const existing = await listResetCodes(sb);
  const mine = existing.filter((r) => r.user_id === input.user_id && r.status === "active");
  for (const old of mine) {
    await sb.from("app_settings").delete().eq("key", settingsKey(old.id)).then(() => {}, () => {});
  }

  const code = generateResetCode();
  const salt = randomBytes(16).toString("hex");
  const now = new Date();
  const ttl = Math.max(1, Math.min(168, input.ttl_hours ?? RESET_CODE_TTL_HOURS));
  const rec: ResetCodeRecord = {
    id: randomBytes(12).toString("hex"),
    user_id: input.user_id,
    email: input.email,
    name: input.name || "",
    role: input.role || "customer",
    code_hash: hashCode(canonicalCode(code), salt),
    attempts: 0,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl * 60 * 60 * 1000).toISOString(),
    used_at: null,
    revoked_at: null,
    issued_by: input.issued_by || "admin",
  };
  if (!(await writeRecord(sb, rec))) return null;
  return { record: rec, code };
}

export function statusOf(rec: ResetCodeRecord): ResetCodeStatus {
  if (rec.used_at) return "used";
  if (rec.revoked_at) return "revoked";
  if (new Date(rec.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

/**
 * Every reset code ever issued, newest first.
 *
 * Rows are read by key prefix. The prefix contains an underscore, which SQL
 * LIKE treats as a single-character wildcard — harmless here because no other
 * key family contains it, but the result is filtered precisely anyway.
 */
export async function listResetCodes(sb: SupabaseClient): Promise<ResetCodeListItem[]> {
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("key, value")
      .like("key", `${KEY_PREFIX}%`);
    if (error || !data) return [];
    const out: ResetCodeListItem[] = [];
    for (const row of data as { key: string; value: string }[]) {
      if (!row.key.startsWith(KEY_PREFIX)) continue;
      let parsed: Partial<ResetCodeRecord>;
      try {
        parsed = JSON.parse(row.value || "");
      } catch {
        continue;
      }
      if (!parsed || typeof parsed.id !== "string" || typeof parsed.user_id !== "string") continue;
      const rec: ResetCodeRecord = {
        id: parsed.id,
        user_id: parsed.user_id,
        email: parsed.email || "",
        name: parsed.name || "",
        role: parsed.role || "customer",
        code_hash: parsed.code_hash || "",
        attempts: Number(parsed.attempts) || 0,
        created_at: parsed.created_at || new Date().toISOString(),
        expires_at: parsed.expires_at || new Date().toISOString(),
        used_at: parsed.used_at || null,
        revoked_at: parsed.revoked_at || null,
        issued_by: parsed.issued_by || "admin",
      };
      out.push({
        id: rec.id,
        user_id: rec.user_id,
        email: rec.email,
        name: rec.name,
        role: rec.role,
        status: statusOf(rec),
        attempts: rec.attempts,
        created_at: rec.created_at,
        expires_at: rec.expires_at,
        used_at: rec.used_at,
        revoked_at: rec.revoked_at,
        issued_by: rec.issued_by,
      });
    }
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return out;
  } catch {
    return [];
  }
}

/** Revokes a code so it can never be redeemed. */
export async function revokeResetCode(sb: SupabaseClient, id: string): Promise<boolean> {
  const rec = await readRecord(sb, id);
  if (!rec) return false;
  if (rec.used_at) return false;
  rec.revoked_at = new Date().toISOString();
  return writeRecord(sb, rec);
}

export type RedeemOutcome =
  | { ok: true; record: ResetCodeRecord }
  | {
      ok: false;
      reason: "not_found" | "expired" | "used" | "revoked" | "locked" | "wrong_code";
      attemptsRemaining: number;
    };

/**
 * Checks a code against a stored record WITHOUT consuming it.
 *
 * Used to tell a user "this code is not valid" before they type a new
 * password, and to give the admin an accurate picture of a code's state.
 */
export function checkCode(rec: ResetCodeRecord, code: unknown): RedeemOutcome {
  if (rec.used_at) return { ok: false, reason: "used", attemptsRemaining: 0 };
  if (rec.revoked_at) return { ok: false, reason: "revoked", attemptsRemaining: 0 };
  if (new Date(rec.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired", attemptsRemaining: 0 };
  }
  if (rec.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked", attemptsRemaining: 0 };
  }
  if (!isWellFormedCode(code) || !verifyCode(canonicalCode(code), rec.code_hash)) {
    return {
      ok: false,
      reason: "wrong_code",
      attemptsRemaining: Math.max(0, RESET_CODE_MAX_ATTEMPTS - rec.attempts - 1),
    };
  }
  return { ok: true, record: rec };
}

/**
 * Validates a code and, on success, marks it used.
 *
 * The mark happens BEFORE the caller sets the password, so a crash between the
 * two burns the code rather than leaving a live one behind — the user asks the
 * admin for a fresh code, which is a five-minute phone call, not a security
 * incident.
 */
export async function redeemResetCode(sb: SupabaseClient, id: string, code: unknown): Promise<RedeemOutcome> {
  const rec = await readRecord(sb, id);
  if (!rec) return { ok: false, reason: "not_found", attemptsRemaining: 0 };

  const verdict = checkCode(rec, code);
  if (!verdict.ok) {
    if (verdict.reason === "wrong_code") {
      rec.attempts += 1;
      await writeRecord(sb, rec);
      return {
        ok: false,
        reason: "wrong_code",
        attemptsRemaining: Math.max(0, RESET_CODE_MAX_ATTEMPTS - rec.attempts),
      };
    }
    return verdict;
  }

  rec.used_at = new Date().toISOString();
  await writeRecord(sb, rec);
  return { ok: true, record: rec };
}

/**
 * Looks a person up so the admin can issue a code for them.
 *
 * Searches the riders table first (a rider is a person who may not have a
 * customer account) and then the auth users (a customer or business owner who
 * never completes rider onboarding). Both are needed: the riders table and
 * the auth user list do not contain the same people.
 */
export async function findResetCandidates(sb: SupabaseClient, query: string): Promise<
  { id: string; email: string; name: string; role: string; source: "rider" | "user" }[]
> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { id: string; email: string; name: string; role: string; source: "rider" | "user" }[] = [];
  const seen = new Set<string>();

  try {
    const { data } = await sb
      .from("riders")
      .select("id, name, email, vehicle_type")
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(25);
    for (const r of (data || []) as { id: string; name: string; email: string }[]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ id: r.id, email: r.email || "", name: r.name || "", role: "rider", source: "rider" });
    }
  } catch {}

  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of data?.users || []) {
      if (seen.has(u.id)) continue;
      const name = (u.user_metadata?.name as string) || (u.user_metadata?.full_name as string) || "";
      const email = u.email || "";
      const role = (u.user_metadata?.role as string) || "customer";
      const hay = `${name} ${email}`.toLowerCase();
      if (!hay.includes(q)) continue;
      seen.add(u.id);
      out.push({ id: u.id, email, name, role, source: "user" });
      if (out.length >= 50) break;
    }
  } catch {}

  return out;
}
