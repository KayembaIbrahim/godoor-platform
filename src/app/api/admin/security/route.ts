import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import QRCode from "qrcode";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  clearTotpSecret, getLoginLog, getSecurityStatus, getTotpSecret, saveRecoveryHashes,
  saveTotpSecret,
} from "@/lib/admin-auth";
import { generateRecoveryCodes, otpauthUri, randomSecret, sha256Hex, verifyTotp } from "@/lib/admin-totp";

async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** GET /api/admin/security → 2FA state + recent login audit log */
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const security = await getSecurityStatus(sb);
  const logins = await getLoginLog(sb);
  return NextResponse.json({ ...security, logins: logins.reverse() });
}

/** POST /api/admin/security/totp/prepare → new secret + QR (nothing stored yet) */
export async function prepareTotp() {
  if (!(await isAuthed())) return unauthorized();
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const current = await getSecurityStatus(sb);
  if (current.enabled) {
    return NextResponse.json({ error: "Two-factor is already enabled." }, { status: 409 });
  }
  const secret = randomSecret();
  const uri = otpauthUri(secret);
  const qr = await QRCode.toDataURL(uri, { width: 240, margin: 1 });
  return NextResponse.json({ secret, otpauthUrl: uri, qr });
}

/** POST /api/admin/security/totp/confirm → validate a live code, then store + issue recovery codes */
export async function confirmTotp(body: Record<string, unknown>) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const { code, secret } = body as { code?: unknown; secret?: unknown };
  if (typeof code !== "string" || typeof secret !== "string" || !/^[A-Z2-7]{16,}$/i.test(secret)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!(await verifyTotp(secret, code))) {
    return NextResponse.json({ error: "That code doesn't match. Check your authenticator app." }, { status: 400 });
  }
  const saved = await saveTotpSecret(sb, secret);
  if (!saved) return NextResponse.json({ error: "Could not save the secret." }, { status: 500 });
  const recoveryCodes = await generateRecoveryCodes();
  const hashes: string[] = [];
  for (const rc of recoveryCodes) {
    hashes.push(await sha256Hex(rc));
  }
  await saveRecoveryHashes(sb, hashes);
  return NextResponse.json({ ok: true, recoveryCodes });
}

/** POST /api/admin/security/totp/disable → confirm a live code, then remove 2FA */
export async function disableTotp(body: Record<string, unknown>) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const { code } = body as { code?: unknown };
  if (typeof code !== "string") return NextResponse.json({ error: "Enter a code to confirm" }, { status: 400 });
  const secret = await getTotpSecret(sb);
  if (!secret) return NextResponse.json({ error: "Two-factor is not enabled." }, { status: 409 });
  if (!(await verifyTotp(secret, code))) {
    return NextResponse.json({ error: "That code doesn't match." }, { status: 400 });
  }
  await clearTotpSecret(sb);
  return NextResponse.json({ ok: true });
}

const HANDLERS: Record<string, (body: Record<string, unknown>) => Promise<Response>> = {
  prepare: () => prepareTotp(),
  confirm: confirmTotp,
  disable: disableTotp,
};

export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = body.action || "prepare";
  const handler = HANDLERS[action];
  if (!handler) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  return handler(body);
}