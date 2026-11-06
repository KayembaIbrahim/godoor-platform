import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import {
  listOpenForRiders,
  listRiderLists,
  claimList,
} from "@/lib/shopping-list-store";
import { shoppingListRiderShare } from "@/lib/shopping-list";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rider GoMart board — `/api/rider/gomart`.
 *
 * GET  — the rider's GoMart queue:
 *        `open`     — claimable submitted/confirmed lists (no rider yet),
 *        `mine`     — lists this rider is carrying,
 *        `history`  — lists this rider delivered.
 * POST — claim a list (`{ listId }`). First rider wins; the loser gets 409.
 *
 * Auth: signed-in user whose role is rider (or admin, for staff fallback).
 * The rider id is taken from the validated JWT — never from the body — so
 * a rider cannot claim on behalf of someone else.
 */

function shape(row: any) {
  return {
    id: row.id,
    name: row.name ?? "GoMart shopping list",
    status: row.status,
    items: Array.isArray(row.items) ? row.items : [],
    shopping_fee_ugx: row.shopping_fee_ugx,
    rider_share_ugx: shoppingListRiderShare(row.shopping_fee_ugx),
    merchandise_ugx: row.merchandise_ugx,
    delivery_fee_ugx: row.delivery_fee_ugx,
    total_ugx: row.total_ugx,
    customer_id: row.customer_id,
    customer_name: row.customer_name ?? "Customer",
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** GET /api/rider/gomart — open + mine + history for the signed-in rider. */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (actor.kind !== "user" || (actor.role !== "rider" && actor.kind !== "admin")) {
    return NextResponse.json({ error: "Riders only" }, { status: 403 });
  }

  const riderId = actor.kind === "user" ? actor.id : "";
  const [open, mine, history] = await Promise.all([
    listOpenForRiders(sb),
    riderId ? listRiderLists(sb, riderId) : Promise.resolve([]),
    riderId ? listRiderLists(sb, riderId) : Promise.resolve([]),
  ]);

  const active = mine.filter((r) => ["assigned", "shopping", "delivering"].includes(r.status));
  const done = mine.filter((r) => ["delivered"].includes(r.status));
  return NextResponse.json(
    {
      open: open.map(shape),
      mine: active.map(shape),
      history: done.map(shape),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

/** POST /api/rider/gomart — claim a list. First rider wins. */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (actor.kind !== "user" || (actor.role !== "rider" && actor.kind !== "admin")) {
    return NextResponse.json({ error: "Riders only" }, { status: 403 });
  }

  let body: { listId?: unknown };
  try {
    body = (await req.json()) as { listId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const listId = typeof body.listId === "string" ? body.listId.trim() : "";
  if (!listId) {
    return NextResponse.json({ error: "listId is required" }, { status: 400 });
  }

  const riderId = actor.kind === "user" ? actor.id : "";
  const result = await claimList(sb, listId, riderId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, data: shape(result.list) });
}
