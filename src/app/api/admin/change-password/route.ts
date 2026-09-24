import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { evaluatePassword, passwordError } from "@/lib/password-strength";
import {
  ADMIN_COOKIE, setAdminPassword, verifyAdminPassword, verifySession,
} from "@/lib/admin-auth";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  if (!(await verifySession(token))) {
    return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
  const sb = getServiceClient();
  const body = await req.json().catch(() => ({}));
  const current: unknown = body?.currentPassword;
  const next: unknown = body?.newPassword;
  if (typeof current !== "string" || typeof next !== "string") {
    return NextResponse.json({ error: "Fill in both password fields" }, { status: 400 });
  }
  if (!evaluatePassword(next).ok) {
    return NextResponse.json({ error: passwordError(next) || "Password is too weak" }, { status: 400 });
  }
  if (next === current) {
    return NextResponse.json({ error: "New password must be different from the current one" }, { status: 400 });
  }
  if (!sb) {
    return NextResponse.json({ error: "Server auth is not configured" }, { status: 500 });
  }
  const valid = await verifyAdminPassword(sb, current);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }
  const saved = await setAdminPassword(sb, next);
  if (!saved) {
    return NextResponse.json({ error: "Could not save the new password. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
