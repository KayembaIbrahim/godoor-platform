import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { invalidatePromos, readPromoList, writePromoList } from "@/lib/promo-server";
import { mergePromoTable, PROMOS, sanitizePromoTable } from "@/lib/promo";
import { FIRST_ORDER_OFFER } from "@/lib/first-order-offer";
export const runtime = "nodejs";

/**
 * Admin management of promo codes.
 *
 * GET returns the merged view — admin entries folded over the shipped defaults
 * — because the portal has to show what customers can actually redeem,
 * including the codes nobody has edited yet. PUT replaces the admin-authored
 * set atomically: it is validated in full before anything is written, so a
 * rejected field can never leave the portal showing a table the database does
 * not contain.
 *
 * Gated by the admin session cookie, the same gate every other admin mutation
 * uses. The secret path only hides the door.
 */

export const dynamic = "force-dynamic";

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const list = await readPromoList(sb);
  return NextResponse.json({
    /* `null` means nothing has been saved yet, so the portal can show the
       defaults as a starting point rather than an empty screen. */
    saved: list,
    effective: mergePromoTable(list),
    defaults: PROMOS,
    offer: { code: FIRST_ORDER_OFFER.code, percent: FIRST_ORDER_OFFER.percent },
  });
}

export async function PUT(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = Array.isArray(body) ? body : (body as { promos?: unknown })?.promos;
  const clean = sanitizePromoTable(raw);
  if (!clean) {
    return NextResponse.json(
      { error: "One or more promo codes were invalid and nothing was saved" },
      { status: 400 },
    );
  }

  const result = await writePromoList(sb, clean);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  invalidatePromos();
  return NextResponse.json({ ok: true, promos: result.promos, effective: mergePromoTable(result.promos) });
}

/**
 * DELETE restores the shipped defaults.
 *
 * Exists because "the promos are all wrong and I want yesterday back" is a real
 * thing an owner will need at 02:00, and the only other route to it is editing
 * JSON by hand in a production database.
 */
export async function DELETE() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { error } = await sb.from("app_settings").delete().eq("key", "promos:v1");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  invalidatePromos();
  return NextResponse.json({ ok: true, effective: PROMOS });
}