/**
 * Edge-safe admin session helpers (usable in middleware AND server routes).
 * Uses WebCrypto (crypto.subtle) so it runs on Vercel Edge Functions —
 * node:crypto is NOT allowed there. Password hashing stays in admin-auth.ts.
 */

export const ADMIN_COOKIE = "godoor_admin_session";
export const ADMIN_P2FA_COOKIE = "godoor_admin_p2fa";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h token validity — cookie is still session-only
export const P2FA_TTL_MS = 5 * 60 * 1000; // password-step grant expires in 5 minutes

const enc = new TextEncoder();

/** Shared HMAC secret for session signing + TOTP secret encryption. */
export function adminSessionSecret(): string {
  const env = process.env.ADMIN_SESSION_SECRET;
  if (env) return env;
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "godoor-local-dev";
}

async function hmacHex(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(adminSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlEncode(json: string): string {
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(b64: string): string {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
  return atob(padded);
}

export async function signSession(tokenTtlMs: number = SESSION_TTL_MS): Promise<string> {
  const payload = b64urlEncode(JSON.stringify({ v: 1, exp: Date.now() + tokenTtlMs }));
  const sig = await hmacHex(payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payload || !sig) return false;
  const expected = await hmacHex(payload);
  // Constant-time compare
  const a = enc.encode(sig);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return false;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Temporary grant created right after a correct password when 2FA is enabled.
 * Carries a random nonce so a code-only replay (without the password step)
 * can never mint a session.
 */
export async function signPending2fa(): Promise<string> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const payload = b64urlEncode(JSON.stringify({ v: 2, kind: "p2fa", n: nonce, exp: Date.now() + P2FA_TTL_MS }));
  const sig = await hmacHex(payload);
  return `${payload}.${sig}`;
}

export async function verifyPending2fa(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payload || !sig) return false;
  const expected = await hmacHex(payload);
  const a = enc.encode(sig);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return false;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    return data.v === 2 && data.kind === "p2fa" && typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}