import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  findResetCandidates, issueResetCode, listResetCodes, revokeResetCode,
} from "@/lib/password-reset-server";

export const runtime = "nodejs";

/**
 * Admin-side management of one-time password-reset codes.
 *
 * GET    → list every code ever issued (active, used, expired, revoked)
 * POST   → issue a new code for a person, or search for one
 * DELETE → revoke an outstanding code
 *
 * The whole route sits behind the admin session cookie, which the proxy also
 * enforces — so an anonymous caller gets a 404 from the proxy before it ever
 * reaches this handler.
 */

async function hasAdminSession(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const codes = await listResetCodes(sb);
  return NextResponse.json({ codes });
}

export async function POST(req: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "issue";

  // ── Search: who can this code be issued for? ──────────────────────────────
  if (action === "search") {
    const q = typeof body.query === "string" ? body.query : "";
    if (!q.trim()) return NextResponse.json({ candidates: [] });
    const candidates = await findResetCandidates(sb, q);
    return NextResponse.json({ candidates });
  }

  // ── Issue ─────────────────────────────────────────────────────────────────
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "customer";
  if (!userId || !email) {
    return NextResponse.json({ error: "Pick a person to issue a reset code for." }, { status: 400 });
  }

  // Re-read the person from the database rather than trusting the posted
  // email — the admin UI could be tampered with, and a code issued against a
  // spoofed address would be sent to the wrong person.
  let realEmail = email;
  let realName = name;
  let realRole = role;
  try {
    const { data: authUser } = await sb.auth.admin.getUserById(userId);
    if (authUser?.user) {
      realEmail = authUser.user.email || email;
      const meta = authUser.user.user_metadata || {};
      realName = (meta.name as string) || (meta.full_name as string) || name;
      realRole = (meta.role as string) || role;
    }
  } catch {}

  const issued = await issueResetCode(sb, {
    user_id: userId,
    email: realEmail,
    name: realName,
    role: realRole,
    issued_by: "admin",
  });
  if (!issued) {
    return NextResponse.json({ error: "Could not issue the reset code. Try again." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    code: issued.code,
    id: issued.record.id,
    email: issued.record.email,
    name: issued.record.name,
    role: issued.record.role,
    expires_at: issued.record.expires_at,
  });
}

export async function DELETE(req: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const ok = await revokeResetCode(sb, id);
  if (!ok) return NextResponse.json({ error: "That code could not be revoked." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
