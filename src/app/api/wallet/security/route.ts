import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import {
  securityTableReady, readSecurity, hashPin, validatePinFormat, randomToken,
  issueSpendGrant, isLocked, lockFor, upsertSecurity,
  registerOptions, assertOptions, storeChallenge, takeChallenge, clearChallenge,
  parseAssertion, verifyAssertion, coseToJwk, algosFor, b64url, unb64url, timingSafeEqual,
  type WalletSecurityRow,
} from "@/lib/wallet-security";

/**
 * Wallet security API.
 *
 *   GET    → status (has PIN, has biometric, lockout state)
 *   POST   → { action: 'set_pin' | 'grant_pin' | 'grant_bio' | 'bio_challenge' }
 *
 * PINs are hashed with PBKDF2 here and never leave the server. A successful
 * check mints a 90-second signed grant; the money paths spend that grant.
 */

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function ctx(req: NextRequest) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") return { error: fail("Sign in to continue", 401) as NextResponse };
  const sb = getServiceClient();
  if (!sb) return { error: fail("Wallet unavailable", 503) as NextResponse };
  if (!(await securityTableReady(sb))) {
    return {
      error: NextResponse.json(
        { error: "Wallet security is not available yet", unavailable: true },
        { status: 503 },
      ) as NextResponse,
    };
  }
  return { sb, userId: actor.id };
}

function origins(req: NextRequest): string[] {
  const list = new Set<string>();
  const host = req.headers.get("host");
  if (host) {
    list.add(`https://${host}`);
    list.add(`http://${host}`);
    // The proxy folds www into the apex, so both origins must be accepted.
    if (host.startsWith("www.")) list.add(`https://${host.slice(4)}`);
  }
  const fwd = req.headers.get("x-forwarded-proto");
  const xh = req.headers.get("x-forwarded-host");
  if (fwd && xh) list.add(`${fwd}://${xh}`);
  return [...list];
}

export async function GET(req: NextRequest) {
  const c = await ctx(req);
  if ("error" in c) return c.error;
  const row = await readSecurity(c.sb, c.userId);
  return NextResponse.json({
    hasPin: !!row?.pin_hash,
    hasBiometric: !!row?.bio_credential_id,
    locked: isLocked(row),
    lockedUntil: isLocked(row) ? row?.locked_until : null,
  });
}

export async function POST(req: NextRequest) {
  const c = await ctx(req);
  if ("error" in c) return c.error;
  const { sb, userId } = c;

  let body: Record<string, unknown>;
  try {
    body = ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return fail("Invalid request");
  }
  const action = String(body.action || "");
  const row: WalletSecurityRow | null = await readSecurity(sb, userId);

  /* ── Set or change the PIN ────────────────────────────────────────────── */
  if (action === "set_pin") {
    const pin = validatePinFormat(body.pin);
    if (!pin.ok) return fail(pin.error);

    /* Changing an existing PIN requires proving you know the old one. Without
       this, a stolen session alone could replace the PIN and then spend. */
    if (row?.pin_hash) {
      const current = validatePinFormat(body.currentPin);
      if (!current.ok) return fail("Enter your current PIN");
      if (isLocked(row)) return fail("Too many attempts. Try again shortly.", 429);
      const attempt = await hashPin(current.pin, row.pin_salt as string);
      if (!timingSafeEqual(attempt, row.pin_hash)) {
        await recordFailure(sb, userId, row);
        return fail("Current PIN is incorrect");
      }
    }

    const salt = randomToken(16);
    const hash = await hashPin(pin.pin, salt);
    await upsertSecurity(sb, userId, {
      pin_hash: hash,
      pin_salt: salt,
      pin_set_at: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null,
    });
    return NextResponse.json({ ok: true, grant: await issueSpendGrant(userId, "pin") });
  }

  /* ── Exchange a PIN for a spend grant ─────────────────────────────────── */
  if (action === "grant_pin") {
    if (!row?.pin_hash) return fail("Set a wallet PIN first", 428);
    if (isLocked(row)) return fail("Too many attempts. Try again shortly.", 429);
    const pin = validatePinFormat(body.pin);
    if (!pin.ok) return fail(pin.error);

    const attempt = await hashPin(pin.pin, row.pin_salt as string);
    if (!timingSafeEqual(attempt, row.pin_hash)) {
      await recordFailure(sb, userId, row);
      return fail("Incorrect PIN");
    }
    await upsertSecurity(sb, userId, { failed_attempts: 0, locked_until: null });
    return NextResponse.json({ ok: true, grant: await issueSpendGrant(userId, "pin") });
  }

  /* ── Biometric ────────────────────────────────────────────────────────── */
  if (action === "bio_challenge") {
    const challenge = randomToken(32);
    await storeChallenge(sb, userId, challenge);
    // Enrolment needs a challenge too; assertion only makes sense once enrolled.
    const opts = row?.bio_credential_id
      ? assertOptions(challenge)
      : registerOptions(challenge, { id: userId, name: String(body.name || "GoDoor customer") });
    return NextResponse.json({ challenge, options: opts });
  }

  if (action === "bio_enrol") {
    const expected = await takeChallenge(sb, userId);
    if (!expected) return fail("Session expired — try again", 400);
    const raw = (body.credential || {}) as Record<string, unknown>;
    const clientDataJSON = String(raw.clientDataJSON || "");
    let client: { type?: string; challenge?: string; origin?: string };
    try {
      client = JSON.parse(clientDataJSON);
    } catch {
      return fail("Malformed response");
    }
    if (client.type !== "webauthn.create") return fail("Wrong credential type");
    if (client.challenge !== expected) return fail("Challenge mismatch");
    if (!client.origin || !origins(req).includes(client.origin)) return fail("Wrong origin");

    const cose = unb64url(String(raw.publicKey || ""));
    const converted = coseToJwk(cose);
    if (!converted) return fail("Unsupported key type");
    // Prove the key imports before we trust it forever. EC keys need
    // `namedCurve` on import — the verify-shaped algorithm throws here, which
    // would silently make every future biometric check fail.
    try {
      const algos = algosFor(converted.jwk);
      if (!algos) return fail("Unsupported key type");
      await crypto.subtle.importKey("jwk", converted.jwk, algos.import, false, ["verify"]);
    } catch {
      return fail("Key could not be stored");
    }

    await clearChallenge(sb, userId);
    await upsertSecurity(sb, userId, {
      bio_credential_id: String(raw.id || ""),
      bio_public_key: converted.jwk,
      bio_sign_count: 0,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "grant_bio") {
    if (!row?.bio_credential_id || !row.bio_public_key) {
      return fail("No fingerprint or face unlock set up on this device", 428);
    }
    if (isLocked(row)) return fail("Too many attempts. Try again shortly.", 429);
    const expected = await takeChallenge(sb, userId);
    if (!expected) return fail("Session expired — try again", 400);

    const parsed = parseAssertion((body.credential || {}) as Record<string, unknown>);
    if (!parsed) return fail("Malformed response");
    /* The authenticator returns userHandle as base64url of the raw id bytes —
       the same encoding registerOptions() used to enrol it. Comparing it to the
       bare UUID string would fail every time a real sensor supplied one. */
    if (parsed.userHandle && parsed.userHandle !== b64url(new TextEncoder().encode(userId))) {
      return fail("Wrong user");
    }

    const result = await verifyAssertion(parsed, row.bio_public_key as JsonWebKey, expected, {
      rpId: new URL(req.url).hostname,
      origins: origins(req),
    });
    if (!result.ok) {
      await recordFailure(sb, userId, row);
      return fail(result.error, 401);
    }

    // A repeated or decreasing counter means a replayed assertion.
    const prev = Number(row.bio_sign_count ?? 0);
    if (result.newSignCount > 0 && prev > 0 && result.newSignCount <= prev) {
      await recordFailure(sb, userId, row);
      return fail("Replayed biometric check", 401);
    }
    await clearChallenge(sb, userId);
    await upsertSecurity(sb, userId, {
      bio_sign_count: result.newSignCount,
      failed_attempts: 0,
      locked_until: null,
    });
    return NextResponse.json({ ok: true, grant: await issueSpendGrant(userId, "bio") });
  }

  return fail("Unknown action");
}

/**
 * Progressive lockout. The first two slips are forgiven — fat fingers and a
 * rider in the rain are normal — and from the third the wait grows steeply, so
 * a 4-digit PIN cannot be ground down by an unattended phone.
 */
async function recordFailure(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  userId: string,
  row: WalletSecurityRow,
): Promise<void> {
  const failures = Number(row.failed_attempts ?? 0) + 1;
  const lock = lockFor(failures);
  await upsertSecurity(sb, userId, {
    failed_attempts: failures,
    locked_until: lock ? new Date(Date.now() + lock).toISOString() : null,
  });
}