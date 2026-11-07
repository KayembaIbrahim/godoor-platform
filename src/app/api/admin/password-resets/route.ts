import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  findResetCandidates, issueResetCode, listResetCodes, listResetRequests,
  markRequestCodeIssued, revokeResetCode,
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
  const [codes, requests] = await Promise.all([listResetCodes(sb), listResetRequests(sb)]);
  return NextResponse.json({ codes, requests });
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

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "customer";

  // ── Issue ─────────────────────────────────────────────────────────────────
  // A merchant without an auth user cannot receive a reset code (there is no
  // user_id to set a password on). Provision the login on the spot — exactly
  // what "Send a one-time login" means for a business like Asu Snacks. We
  // create the auth user with a random placeholder, issue the reset code, and
  // hand admin the link+code. The auth user's real password is set when it
  // redeems the code at /api/password-reset.
  if (!userId && email) {
    const placeholder = `Gd!${randomBytes(9).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}A1#`;
    try {
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email,
        password: placeholder,
        email_confirm: true,
        user_metadata: { name: name || "", role: "business", must_change_password: true },
      });
      if (cErr) {
        return NextResponse.json({ error: "Could not create a login for this business: " + cErr.message }, { status: 400 });
      }
      const newId = created.user?.id;
      if (!newId) return NextResponse.json({ error: "Could not create a login for this business." }, { status: 500 });
      // Link the merchant to the new owner so the business dashboard resolves.
      try {
        await sb.from("merchants").update({ owner_id: newId }).eq("email", email.toLowerCase());
      } catch {}
      const issued = await issueResetCode(sb, {
        user_id: newId,
        email,
        name: name || "",
        role: "business",
        issued_by: "admin",
      });
      if (!issued) return NextResponse.json({ error: "Could not issue the reset code. Try again." }, { status: 500 });
      return NextResponse.json({
        ok: true,
        code: issued.code,
        id: issued.record.id,
        email: issued.record.email,
        name: issued.record.name,
        role: issued.record.role,
        expires_at: issued.record.expires_at,
        provisioned: true,
        user_id: newId,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Could not provision a login for this business." }, { status: 500 });
    }
  }

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

  // If any self-service ticket exists for this user/email, link it to the code
  try {
    const tickets = await listResetRequests(sb);
    const ticket = tickets.find(
      (t) =>
        (t.user_id && t.user_id === userId) ||
        t.email.toLowerCase() === realEmail.toLowerCase(),
    );
    if (ticket) {
      await markRequestCodeIssued(sb, ticket.id, issued.record.id).catch(() => {});
    }
  } catch {}

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
