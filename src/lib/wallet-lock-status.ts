/**
 * Resolving the wallet-security status, as a pure function.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * The sheet used to fetch its status inline and call `setStatusLoaded(true)` on
 * each branch. Only the two *failure* branches did. The success branch set the
 * data and returned without ever settling, so the moment the request started
 * answering 200 the sheet had no exit from its loading state and sat on
 * "Checking your wallet…" indefinitely.
 *
 * That stayed invisible for a long time because the request used to 401: the
 * failure branch was the only thing marking the status settled, so a broken
 * call looked like a working one. Fixing the missing `Authorization` header
 * turned the 401 into a 200 and exposed the missing settle.
 *
 * Isolating the resolution here removes the whole failure mode: this function
 * has no branches that can forget to return, and the caller settles once,
 * unconditionally. A test can drive it with a fake `fetch` and assert it
 * resolves on every path — success, non-2xx, malformed body and thrown error.
 */

export interface WalletStatusDeps {
  /** Supplies the auth headers. Injected so the tests need no Supabase. */
  authHeaders: () => Promise<Record<string, string>>;
  /** The request itself. Injected for the same reason. */
  request: (headers: Record<string, string>) => Promise<Response>;
}

export type WalletStatus =
  | { ok: true; hasPin: boolean; hasBiometric: boolean; lockedUntil: string | null }
  | { ok: false; error: string };

function serverError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const e = (body as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  return fallback;
}

/**
 * Always resolves. Never throws, never rejects, never returns `undefined` —
 * that guarantee is the entire point of this module.
 */
export async function resolveWalletStatus(deps: WalletStatusDeps): Promise<WalletStatus> {
  let headers: Record<string, string>;
  try {
    headers = await deps.authHeaders();
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }

  let res: Response;
  try {
    res = await deps.request(headers);
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }

  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (!res.ok) {
    return { ok: false, error: serverError(body, "Could not check wallet security") };
  }

  const b = (body ?? {}) as {
    hasPin?: unknown;
    hasBiometric?: unknown;
    locked?: unknown;
    lockedUntil?: unknown;
  };

  // A 200 that carries no usable shape is still a failed check — reporting it as
  // "no PIN set" would let an unlock sheet open as if it were fully enrolled.
  if (b.hasPin === undefined && b.hasBiometric === undefined) {
    return { ok: false, error: "Could not check wallet security" };
  }

  return {
    ok: true,
    hasPin: !!b.hasPin,
    hasBiometric: !!b.hasBiometric,
    lockedUntil: b.locked ? (typeof b.lockedUntil === "string" ? b.lockedUntil : null) : null,
  };
}

/** True when a server-reported lockout timestamp is still in the future. */
export function lockoutActive(lockedUntil: string | null, now = Date.now()): boolean {
  if (!lockedUntil) return false;
  const until = Date.parse(lockedUntil);
  return Number.isFinite(until) && until > now;
}