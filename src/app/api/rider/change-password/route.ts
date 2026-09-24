import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { getApiUser } from "@/lib/api-auth";

/**
 * Clears the "must change password" flag after a rider has replaced their
 * one-time password. The password itself is changed client-side via
 * supabase.auth.updateUser (the signed-in JWT proves ownership); this route
 * only flips the onboarding marker on the account.
 */
export async function DELETE(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const user = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (user.role !== "rider") {
    return NextResponse.json({ error: "This action is for rider accounts" }, { status: 403 });
  }

  const { data: existing } = await sb.auth.admin.getUserById(user.id);
  const meta = existing?.user?.user_metadata || {};

  const { error } = await sb.auth.admin.updateUserById(user.id, {
    user_metadata: { ...meta, must_change_password: false },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}