import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import {
  createList,
  listCustomerLists,
  listAllLists,
} from "@/lib/shopping-list-store";
import { SHOPPING_FEE_PER_ITEM_UGX, SHOPPING_LIST_MIN_ITEMS } from "@/lib/shopping-list";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shopping list API.
 *
 * Lives under `src/app/api/` because that is the only place the App Router
 * mounts a route handler. The previous copy lived in `src/api/`, which the
 * router never served — so the client got a 404 for every request and the
 * feature looked "coded but broken".
 *
 * Auth: every route requires a signed-in actor (admin cookie or Supabase
 * JWT). A customer sees only their own lists; staff and admin see the queue.
 *
 * Money: the shopping service fee is UGX 500 per valid item and is computed
 * here on the server. The client sends items, never totals.
 */

/** GET /api/shopping-list — the caller's lists. */
export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  if (actor.kind === "admin") {
    const lists = await listAllLists(sb);
    return NextResponse.json(
      {
        shoppingLists: lists,
        feePerItemUgx: SHOPPING_FEE_PER_ITEM_UGX,
        minItems: SHOPPING_LIST_MIN_ITEMS,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const lists = await listCustomerLists(sb, actor.id);
  return NextResponse.json(
    {
      shoppingLists: lists,
      feePerItemUgx: SHOPPING_FEE_PER_ITEM_UGX,
      minItems: SHOPPING_LIST_MIN_ITEMS,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

/**
 * POST /api/shopping-list — create a list.
 *
 * Rejects fewer than 5 valid items with 400. The client may send an `id` so
 * a retried submit is idempotent rather than a second charge.
 */
export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (actor.kind === "admin") {
    return NextResponse.json({ error: "Admin cannot create customer shopping lists" }, { status: 403 });
  }

  let body: { id?: string; name?: string; notes?: string; items?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await createList(sb, {
    id: typeof body.id === "string" ? body.id : undefined,
    customerId: actor.id,
    customerEmail: actor.email,
    customerName: actor.name ?? "",
    name: typeof body.name === "string" ? body.name : undefined,
    notes: typeof body.notes === "string" ? body.notes : null,
    rawItems: body.items,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.status },
    );
  }

  return NextResponse.json({ success: true, data: result.list }, { status: 201 });
}
