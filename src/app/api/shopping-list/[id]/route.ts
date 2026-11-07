import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import {
  getList,
  updateList,
  deleteList,
  listEvents,
  addMessage,
} from "@/lib/shopping-list-store";
import type { ShoppingItem, ShoppingListStatus } from "@/lib/shopping-list";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A single shopping list: GET (read), PATCH (workflow), DELETE (cancel).
 *
 * Ownership is enforced here. A customer may read, edit or cancel only their
 * own list, and only while it is still a draft or submitted. Staff (rider /
 * business) and admins may move a list through the workflow, and every
 * transition is checked against the allowed state machine server-side.
 */

type Ctx = { params: Promise<{ id: string }> };

async function canRead(
  actor: { kind: string; id?: string; role?: string },
  row: { customer_id: string | null; rider_id: string | null },
): Promise<boolean> {
  if (actor.kind === "admin") return true;
  if (actor.kind === "user") {
    if (row.customer_id === actor.id) return true;
    if (row.rider_id === actor.id) return true;
  }
  return false;
}

/** GET /api/shopping-list/:id */
export async function GET(req: NextRequest, ctx: Ctx) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const { id } = await ctx.params;
  const row = await getList(sb, id);
  if (!row) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  if (!(await canRead(actor, row))) {
    return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  }

  const events = await listEvents(sb, id);
  // Messages are available to customer + assigned rider + admin only.
  let messages: unknown[] = [];
  try {
    const { listMessages } = await import("@/lib/shopping-list-store");
    messages = await listMessages(sb, id);
  } catch {}
  return NextResponse.json(
    { shoppingList: row, events, messages },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

/**
 * PATCH /api/shopping-list/:id
 *
 * Body:
 *   status?        — the new status (checked against the state machine)
 *   notes?         — free text
 *   items?         — replaced item list (re-validated, fee recomputed)
 *   merchandiseUgx — confirmed merchandise cost (staff only)
 *   deliveryFeeUgx — delivery quote (staff only)
 *   merchantId?    — the store shopping the list (staff only)
 *   riderId?       — the rider carrying it (staff only)
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await getList(sb, id);
  if (!current) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });

  const isOwner = actor.kind === "user" && current.customer_id === actor.id;
  const isStaff = actor.kind === "admin" || (actor.kind === "user" && Boolean(actor.role));
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "You do not have access to this shopping list" }, { status: 403 });
  }

  let body: {
    status?: ShoppingListStatus;
    notes?: string;
    items?: ShoppingItem[];
    merchandiseUgx?: number;
    deliveryFeeUgx?: number;
    actualMerchandiseUgx?: number | null;
    budgetMaxUgx?: number | null;
    merchantId?: string | null;
    riderId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // A customer may not set the money or route the list.
  const staffOnly = isStaff && !isOwner;
  if (
    !staffOnly &&
    (body.merchandiseUgx !== undefined ||
      body.deliveryFeeUgx !== undefined ||
      body.actualMerchandiseUgx !== undefined)
  ) {
    return NextResponse.json(
      { error: "Only staff can set the confirmed costs" },
      { status: 403 },
    );
  }

  // Rider posting the actual cost after shopping → negotiation artifact.
  const actualMerchandiseUgx =
    typeof body.actualMerchandiseUgx === "number" && Number.isFinite(body.actualMerchandiseUgx)
      ? Math.max(0, Math.trunc(body.actualMerchandiseUgx))
      : body.actualMerchandiseUgx === null
        ? null
        : undefined;

  const result = await updateList(sb, id, {
    status: body.status,
    notes: body.notes,
    items: body.items,
    merchandiseUgx: body.merchandiseUgx,
    deliveryFeeUgx: body.deliveryFeeUgx,
    actualMerchandiseUgx,
    budgetMaxUgx:
      typeof body.budgetMaxUgx === "number" && Number.isFinite(body.budgetMaxUgx)
        ? body.budgetMaxUgx
        : body.budgetMaxUgx === null
          ? null
          : undefined,
    merchantId: body.merchantId,
    riderId: body.riderId,
    actorRole: actor.kind === "admin" ? "admin" : staffOnly ? "staff" : "customer",
    actorId: actor.kind === "user" ? actor.id : null,
  });

  // Log a price_offer message when a rider posts a new actual cost.
  if (result.ok && actualMerchandiseUgx !== undefined && staffOnly) {
    try {
      const name =
        (actor as { name?: string }).name ||
        (actor as { email?: string }).email ||
        "Rider";
      await addMessage(
        sb,
        id,
        actor.kind === "user" ? actor.id : null,
        name,
        (actor as { role?: string }).role || "rider",
        actualMerchandiseUgx == null
          ? "Actual items cost cleared"
          : `Actual items cost: ${actualMerchandiseUgx.toLocaleString()} UGX`,
        actualMerchandiseUgx == null ? "chat" : "price_offer",
        actualMerchandiseUgx ?? null,
      );
    } catch {}
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, data: result.list });
}

/** DELETE /api/shopping-list/:id — cancel a list. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await getList(sb, id);
  if (!current) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });

  const isOwner = actor.kind === "user" && current.customer_id === actor.id;
  const isStaff = actor.kind === "admin" || (actor.kind === "user" && Boolean(actor.role));
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "You do not have access to this shopping list" }, { status: 403 });
  }

  const result = await deleteList(
    sb,
    id,
    actor.kind === "admin" ? "admin" : isOwner && !isStaff ? "customer" : "staff",
    actor.kind === "user" ? actor.id : null,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true });
}
