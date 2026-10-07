/**
 * Wallet security — server-authoritative PIN + biometric authorisation.
 *
 * ── Why this is server-side at all ────────────────────────────────────────────
 * A PIN typed into a React component proves nothing: the same bundle contains
 * the comparison and the wallet balance. So the PIN is hashed with PBKDF2 and
 * only ever compared on the server, and spending an authenticated grant is
 * what unlocks the money paths — not a client-side boolean.
 *
 * Biometrics use WebAuthn (platform authenticator: fingerprint / face). The
 * signature is verified here against the public key registered at enrolment,
 * with the challenge, origin and RP-ID hash checked. `navigator.credentials.get`
 * succeeding in a browser proves nothing by itself, so the browser is never
 * trusted with the outcome.
 *
 * ── Shape of the protocol ─────────────────────────────────────────────────────
 *   1. Client authenticates a method once  → issueSpendGrant() → a 90s token
 *   2. Client spends the token              → verifySpendGrant() on the API
 *
 * Re-typing a PIN on every endpoint would be worse UX and strictly worse
 * security (a PIN typed repeatedly is captured more often). A short-lived,
 * user-scoped, HMAC-signed grant is the right primitive.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { adminSessionSecret } from "@/lib/admin-session";

type ServiceClient = SupabaseClient;

const enc = new TextEncoder();

/** PBKDF2-SHA256. 210k iterations is the OWASP floor for PBKDF2-HMAC-SHA256. */
const PBKDF2_ITERATIONS = 210_000;
const PIN_MIN = 4;
const PIN_MAX = 6;

/** A grant is deliberately short — long enough for one checkout, not a session. */
export const GRANT_TTL_MS = 90_000;
export const CHALLENGE_TTL_MS = 120_000;

/**
 * Progressive lockout, indexed by consecutive failures.
 *
 * The first two slips are forgiven — fat fingers, gloves, a rainy roadside are
 * normal — and from the third the wait grows steeply. A 4-digit PIN has 10,000
 * combinations, so an unlimited attempt rate would let an unattended phone be
 * ground down in well under an hour; the ramp makes that impractical while
 * still letting a genuine rider back in within half a minute of one typo.
 */
const LOCK_STEPS_MS = [0, 0, 0, 30_000, 120_000, 600_000, 1_800_000];
const MAX_ATTEMPTS = 5;

export interface WalletSecurityRow {
  user_id: string;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_set_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  bio_credential_id: string | null;
  bio_public_key: unknown;
  bio_sign_count: number | null;
  bio_challenge: string | null;
  bio_challenge_exp: string | null;
}

/* ── encoding ──────────────────────────────────────────────────────────────── */

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/* ── PIN ───────────────────────────────────────────────────────────────────── */

/** Rejects anything we would refuse to store, so the check happens once. */
export function validatePinFormat(pin: unknown): { ok: true; pin: string } | { ok: false; error: string } {
  if (typeof pin !== "string") return { ok: false, error: "Enter your PIN" };
  const trimmed = pin.trim();
  if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(trimmed)) {
    return { ok: false, error: `PIN must be ${PIN_MIN}–${PIN_MAX} digits` };
  }
  if (/^(\d)\1+$/.test(trimmed)) {
    return { ok: false, error: "PIN cannot be all the same digit" };
  }
  if (isSequential(trimmed)) {
    return { ok: false, error: "PIN cannot be sequential" };
  }
  return { ok: true, pin: trimmed };
}

function isSequential(pin: string): boolean {
  let up = true;
  let down = true;
  for (let i = 1; i < pin.length; i++) {
    const d = Number(pin[i]) - Number(pin[i - 1]);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export async function hashPin(pin: string, saltB64: string): Promise<string> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: unb64url(saltB64) as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    256,
  );
  return b64url(bits);
}

/**
 * Constant-time comparison. A byte-by-byte early return leaks the hash prefix
 * through response timing, which is enough to recover a PIN offline.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── spend grants ──────────────────────────────────────────────────────────── */

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(adminSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data) as BufferSource));
}

/** A short-lived, user-scoped proof that a PIN or biometric was just checked. */
export async function issueSpendGrant(userId: string, method: "pin" | "bio"): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ uid: userId, m: method, exp: Date.now() + GRANT_TTL_MS })));
  return `${payload}.${await hmacHex(payload)}`;
}

/** Returns the method the grant was issued for, or null if it is not usable. */
export async function verifySpendGrant(token: string | null, userId: string): Promise<"pin" | "bio" | null> {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeEqual(sig, await hmacHex(payload))) return null;
  let parsed: { uid?: string; m?: string; exp?: number };
  try {
    parsed = JSON.parse(new TextDecoder().decode(unb64url(payload)));
  } catch {
    return null;
  }
  /* Bound to this user: a grant lifted from one account is worthless on another. */
  if (parsed.uid !== userId) return null;
  if (!parsed.exp || parsed.exp < Date.now()) return null;
  return parsed.m === "bio" ? "bio" : parsed.m === "pin" ? "pin" : null;
}

/* ── row access ────────────────────────────────────────────────────────────── */

const SECURITY_TABLE = "wallet_security";

/** True when the table exists. Absent schema must degrade, never 500. */
export async function securityTableReady(sb: ServiceClient): Promise<boolean> {
  try {
    const { error } = await sb.from(SECURITY_TABLE).select("user_id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function readSecurity(sb: ServiceClient, userId: string): Promise<WalletSecurityRow | null> {
  const { data, error } = await sb.from(SECURITY_TABLE).select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return data as WalletSecurityRow;
}

async function upsertSecurity(sb: ServiceClient, userId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await sb.from(SECURITY_TABLE).upsert({ user_id: userId, ...patch });
  if (error) throw new Error(error.message);
}

/* ── lockout ───────────────────────────────────────────────────────────────── */

export function lockFor(failures: number): number {
  return LOCK_STEPS_MS[Math.min(failures, LOCK_STEPS_MS.length - 1)] ?? 0;
}

export function isLocked(row: WalletSecurityRow | null, now = Date.now()): boolean {
  if (!row?.locked_until) return false;
  const until = Date.parse(row.locked_until);
  return Number.isFinite(until) && until > now;
}

/* ── COSE → JWK ────────────────────────────────────────────────────────────── */

/**
 * WebCrypto only verifies keys in PEM/JWK form; browsers hand us COSE. Without
 * this translation the signature cannot be checked at all — which would mean
 * silently accepting any "biometric" the client claims to have made.
 *
 * Layout for EC2 (kty=2): kty, alg, crv, x_len, x, y_len, y
 * Layout for OKP (kty=1): kty, alg, crv, x_len, x
 */
export function coseToJwk(cose: Uint8Array): { jwk: JsonWebKey; alg: number } | null {
  const view = new DataView(cose.buffer, cose.byteOffset, cose.byteLength);
  try {
    const kty = view.getUint8(0);
    const alg = view.getInt8(1);

    if (kty === 2) {
      // EC2
      const crv = view.getInt8(2);
      if (crv !== -1) return null; // only P-256 / ES256
      let off = 3;
      const xl = view.getUint8(off++);
      const x = cose.slice(off, off + xl); off += xl;
      const yl = view.getUint8(off++);
      const y = cose.slice(off, off + yl);
      return {
        jwk: { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y), ext: true },
        alg: -7,
      };
    }

    if (kty === 1) {
      // OKP (Ed25519)
      const crv = view.getInt8(2);
      if (crv !== 6) return null;
      let off = 3;
      const xl = view.getUint8(off++);
      const x = cose.slice(off, off + xl);
      return {
        jwk: { kty: "OKP", crv: "Ed25519", x: b64url(x), ext: true },
        alg: -8,
      };
    }
  } catch {
    return null;
  }
  return null;
}

type VerifyAlgo = { name: "ECDSA"; hash: "SHA-256" } | { name: "Ed25519" };
/**
 * `importKey` and `verify` take DIFFERENT algorithm shapes for EC keys:
 * importing a JWK needs `namedCurve`, signing/verifying needs `hash`. Passing
 * the verify shape to importKey throws `ERR_MISSING_OPTION`, which made every
 * single biometric check fail with "Stored key is unusable".
 */
type ImportAlgo = { name: "ECDSA"; namedCurve: "P-256" } | { name: "Ed25519" };

export function algosFor(jwk: JsonWebKey): { import: ImportAlgo; verify: VerifyAlgo } | null {
  if (jwk.crv === "P-256") {
    return { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } };
  }
  if (jwk.crv === "Ed25519") {
    return { import: { name: "Ed25519" }, verify: { name: "Ed25519" } };
  }
  return null;
}

function verifyAlgoFor(alg: number): VerifyAlgo | null {
  if (alg === -7) return { name: "ECDSA", hash: "SHA-256" };
  if (alg === -8) return { name: "Ed25519" };
  return null;
}

export interface ParsedAssertion {
  clientDataJSON: string;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  userHandle: string | null;
}

/** Split a WebAuthn assertion into its parts, validating only structure here. */
export function parseAssertion(raw: Record<string, unknown>): ParsedAssertion | null {
  try {
    const clientDataJSON = String(raw.clientDataJSON || "");
    const authenticatorData = unb64url(String(raw.authenticatorData || ""));
    const signature = unb64url(String(raw.signature || ""));
    if (!clientDataJSON || authenticatorData.length < 37 || !signature.length) return null;
    let userHandle: string | null = null;
    if (raw.userHandle) userHandle = String(raw.userHandle);
    return { clientDataJSON, authenticatorData, signature, userHandle };
  } catch {
    return null;
  }
}

/**
 * Full server-side WebAuthn assertion check: type, origin, RP-ID hash and the
 * signature itself. Any failure is a rejection — there is no "probably fine".
 */
export async function verifyAssertion(
  parsed: ParsedAssertion,
  storedJwk: JsonWebKey,
  expectedChallenge: string,
  options: { rpId: string; origins: string[] },
): Promise<{ ok: true; newSignCount: number } | { ok: false; error: string }> {
  let client: { type?: string; challenge?: string; origin?: string };
  try {
    client = JSON.parse(parsed.clientDataJSON);
  } catch {
    return { ok: false, error: "Malformed assertion" };
  }
  if (client.type !== "webauthn.get") return { ok: false, error: "Wrong assertion type" };
  if (client.challenge !== expectedChallenge) return { ok: false, error: "Challenge mismatch" };
  if (!client.origin || !options.origins.includes(client.origin)) {
    return { ok: false, error: "Wrong origin" };
  }

  /* RP ID hash: the first 32 bytes of authenticatorData are SHA-256(rpId). */
  const expectedRpHash = await sha256(options.rpId);
  const actualRpHash = parsed.authenticatorData.slice(0, 32);
  if (!timingSafeEqual(b64url(expectedRpHash), b64url(actualRpHash))) {
    return { ok: false, error: "RP ID mismatch" };
  }

  /* Sign count lives at bytes 33..36 (after the 1-byte user-present flags). */
  const flags = parsed.authenticatorData[32];
  if (!(flags & 0x01)) return { ok: false, error: "User presence not asserted" };
  const signCount = new DataView(
    parsed.authenticatorData.buffer,
    parsed.authenticatorData.byteOffset + 33,
    4,
  ).getUint32(0);

  const jwk = storedJwk as JsonWebKey;
  const algos = algosFor(jwk);
  if (!algos) return { ok: false, error: "Unsupported key type" };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", jwk, algos.import, false, ["verify"]);
  } catch {
    return { ok: false, error: "Stored key is unusable" };
  }

  const signed = new Uint8Array(parsed.authenticatorData.length + 32);
  signed.set(parsed.authenticatorData, 0);
  signed.set(await sha256(parsed.clientDataJSON), parsed.authenticatorData.length);

  const ok = await crypto.subtle.verify(
    algos.verify,
    key,
    parsed.signature as BufferSource,
    signed as BufferSource,
  );
  if (!ok) return { ok: false, error: "Signature check failed" };
  return { ok: true, newSignCount: signCount };
}

/* ── enrolment options ─────────────────────────────────────────────────────── */

export function registerOptions(challenge: string, user: { id: string; name: string }) {
  return {
    challenge,
    rp: { name: "GoDoor" },
    user: { id: b64url(enc.encode(user.id)), name: user.name, displayName: user.name },
    pubKeyCredParams: [
      { type: "public-key" as const, alg: -7 },
      { type: "public-key" as const, alg: -8 },
    ],
    timeout: 60_000,
    attestation: "none" as const,
    authenticatorSelection: {
      authenticatorAttachment: "platform" as const,
      residentKey: "preferred" as const,
      userVerification: "required" as const,
    },
  };
}

export function assertOptions(challenge: string) {
  return {
    challenge,
    timeout: 60_000,
    userVerification: "required" as const,
  };
}

export async function storeChallenge(
  sb: ServiceClient,
  userId: string,
  challenge: string,
): Promise<void> {
  await upsertSecurity(sb, userId, {
    bio_challenge: challenge,
    bio_challenge_exp: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
}

export async function takeChallenge(sb: ServiceClient, userId: string): Promise<string | null> {
  const row = await readSecurity(sb, userId);
  if (!row?.bio_challenge) return null;
  if (!row.bio_challenge_exp || Date.parse(row.bio_challenge_exp) < Date.now()) return null;
  return row.bio_challenge;
}

export async function clearChallenge(sb: ServiceClient, userId: string): Promise<void> {
  await upsertSecurity(sb, userId, { bio_challenge: null, bio_challenge_exp: null });
}

/**
 * Has this customer opted into wallet locking?
 *
 * Money paths use this to decide whether to demand a grant. Returning false
 * for a customer who never set a PIN keeps checkout working; returning true
 * means they enrolled, so every subsequent spend is checked. A missing table
 * also returns false — an unapplied schema must degrade, never lock everyone
 * out of paying.
 */
export async function walletSecurityEnrolled(
  sb: ServiceClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from(SECURITY_TABLE)
      .select("pin_hash, bio_credential_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return false;
    const row = data as { pin_hash?: string | null; bio_credential_id?: string | null };
    return !!row.pin_hash || !!row.bio_credential_id;
  } catch {
    return false;
  }
}

export { upsertSecurity, MAX_ATTEMPTS };