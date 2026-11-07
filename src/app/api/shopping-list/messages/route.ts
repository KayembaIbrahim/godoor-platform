import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { getList, listMessages, addMessage } from "@/lib/shopping-list-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/shopping-list/messages?id=...
 * POST /api/shopping-list/messages { listId, text, kind?, amountUgx? }
 */

async function canAccess(actor: { kind: string; id?: string; role?: string }, row: { customer_id: string | null; rider_id: string | null }): Promise<boolean> {
  if (actor.kind === "admin") return true;
  if (actor.kind === "user") {
    if (row.customer_id === actor.id) return true;
    if (row.rider_id === actor.id) return true;
    if (actor.role === "rider") {
      // A rider who has claimed the list (rider_id set above) or is viewing an open list
      // may read to decide whether to claim — but only after claim is rider_id set.
      // Open lists have rider_id null; riders see them via /api/rider/gomart.
      return false;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("listId") || "";
  if (!id) return NextResponse.json({ error: "listId required" }, { status: 400 });

  const row = await getList(sb, id);
  if (!row) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  if (!(await canAccess(actor, row))) {
    return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  }

  const messages = await listMessages(sb, id);
  return NextResponse.json({ messages, list: row }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  let body: { listId?: unknown; text?: unknown; kind?: unknown; amountUgx?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const listId = typeof body.listId === "string" ? body.listId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!listId) return NextResponse.json({ error: "listId required" }, { status: 400 });
  if (!text && body.kind !== "approval" && body.kind !== "fund_topup" && body.kind !== "price_offer" && body.kind !== "extra_request") {
    return NextResponse.json({ error: "Message text required" }, { status: 400 });
  }

  const row = await getList(sb, listId);
  if (!row) return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  if (!(await canAccess(actor, row))) {
    return NextResponse.json({ error: "Shopping list not found" }, { status: 404 });
  }

  const kindRaw = typeof body.kind === "string" ? body.kind : "chat";
  const kind: "chat" | "price_offer" | "extra_request" | "approval" | "fund_topup" =
    ["chat", "price_offer", "extra_request", "approval", "fund_topup"].includes(kindRaw)
      ? (kindRaw as any)
      : "chat";

  let amountUgx: number | null = null;
  if (typeof body.amountUgx === "number" && Number.isFinite(body.amountUgx)) {
    amountUgx = Math.max(0, Math.trunc(body.amountUgx));
  }

  const senderName =
    (actor as { name?: string }).name ||
    (actor as { email?: string }).email ||
    (actor as { role?: string }).role ||
    "User";
  const senderRole = (actor as { role?: string }).role || "customer";

  const msg = await addMessage(sb, listId, actor.kind === "user" ? actor.id : null, senderName, senderRole, text || kind, kind, amountUgx);
  return NextResponse.json({ success: true, message: msg });
}
