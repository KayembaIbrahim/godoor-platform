import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { listLedger } from "@/lib/escrow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ledger — the platform-wide escrow audit trail.
 *
 * `ledger_entries` is the append-only money table that every money path
 * already writes: credit approvals, order holds, releases, commissions,
 * refunds and payouts all land here. The customer-facing ledger only shows a
 * single account, so an admin auditing the escrow had no way to read it.
 *
 * This route surfaces that same canonical table to the admin portal:
 *
 *   GET /api/admin/ledger                 → the last 200 entries
 *   GET /api/admin/ledger?type=deposit    → only credit approvals
 *   GET /api/admin/ledger?user_id=<uuid>  → one account's movements
 *
 * Read-only: it never writes and never mutates a balance. It is gated by the
 * same admin session cookie as every other admin route — the secret path only
 * hides the door, the cookie is the lock.
 */
export async function GET(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || undefined;
  const userId = url.searchParams.get("user_id") || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;

  try {
    const entries = await listLedger(sb, { limit, type, userId });

    // Attach the account name/email so the trail is readable without a
    // second lookup. A missing profile row must not fail the whole read.
    const userIds = Array.from(new Set(entries.map((e) => e.user_id).filter(Boolean)));
    const names = new Map<string, { name: string; email: string }>();
    if (userIds.length > 0) {
      const { data: profiles } = await sb
        .from("profiles")
        .select("id, name, email")
        .in("id", userIds);
      for (const p of profiles || []) {
        names.set(p.id, { name: p.name || "", email: p.email || "" });
      }
    }

    return NextResponse.json({
      entries: entries.map((e) => ({
        ...e,
        user_name: names.get(e.user_id)?.name || "",
        user_email: names.get(e.user_id)?.email || "",
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read the ledger" },
      { status: 500 },
    );
  }
}
