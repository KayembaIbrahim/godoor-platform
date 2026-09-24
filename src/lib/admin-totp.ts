/**
 * Server-only TOTP (RFC 6238) helpers for the admin 2-step login.
 * WebCrypto only — safe on Vercel Node runtimes and works with standard
 * authenticator apps (Google Authenticator, Ente Auth, Aegis, etc.).
 */

import { adminSessionSecret } from "./admin-session";

const enc = new TextEncoder();

// A-Z2-7 alphabet without padding (standard RFC 4648 base32)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 5) {
    const n = Math.min(5, bytes.length - i);
    let buffer = 0;
    let bits = 0;
    for (let j = 0; j < n; j++) {
      buffer = (buffer << 8) | bytes[i + j];
      bits += 8;
    }
    while (bits > 0) {
      bits -= 5;
      out += B32[(buffer >> bits) & 0x1f];
    }
  }
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function randomBytesN(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function randomSecret(): string {
  return base32Encode(randomBytesN(20)).slice(0, 32);
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, data as BufferSource);
  return new Uint8Array(sig);
}

export async function totpCode(secret: string, atMs: number = Date.now()): Promise<string> {
  const key = base32Decode(secret);
  const timeStep = Math.floor(atMs / 1000 / 30);
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint32(4, timeStep >>> 0, false); // big-endian
  const hmac = await hmacSha1(key, buf);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

/** Verify a 6-digit code against the secret, allowing ±1 time step. */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Date.now();
  for (let i = -1; i <= 1; i++) {
    const candidate = await totpCode(secret, now + i * 30 * 1000);
    // constant-time-ish compare
    let diff = 0;
    for (let j = 0; j < candidate.length; j++) diff |= candidate.charCodeAt(j) ^ clean.charCodeAt(j);
    if (diff === 0) return true;
  }
  return false;
}

// ─── Encrypt-at-rest for the stored TOTP secret ────────────────────────────

async function deriveAesKey(): Promise<CryptoKey> {
  const raw = adminSessionSecret();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(secret: string): Promise<string> {
  const key = await deriveAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret));
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return `enc$${ivB64}$${ctB64}`;
}

export async function decryptSecret(stored: string): Promise<string | null> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "enc") return null;
  try {
    const key = await deriveAesKey();
    const iv = new Uint8Array(atob(parts[1]).split("").map((c) => c.charCodeAt(0)));
    const ct = new Uint8Array(atob(parts[2]).split("").map((c) => c.charCodeAt(0)));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// ─── Recovery codes (SHA-256 hashes, single use) ───────────────────────────

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomRecoveryCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes).slice(0, 10);
}

export async function generateRecoveryCodes(count = 10): Promise<string[]> {
  const codes = Array.from({ length: count }, randomRecoveryCode);
  return codes;
}

/** otpauth URI for the QR code / manual entry. */
export function otpauthUri(secret: string, label = "GoDoor Admin", issuer = "GoDoor"): string {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6&algorithm=SHA1`;
}