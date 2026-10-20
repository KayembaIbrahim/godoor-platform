/**
 * Server-side storage for customer SHOPPING LISTS.
 *
 * ── Why a dedicated table, and why it is bootstrapped at runtime ───────────
 * A shopping list is a first-class record: it has a lifecycle (submitted →
 * shopping → awaiting approval → confirmed → assigned → delivering →
 * delivered), staff edit it, and it must survive a restart. The old
 * implementation kept lists in a module-level `Map` inside
 * `src/api/shopping-list/route.ts`, which meant every list was lost on the
 * next deploy and on every cold start, and the route was not even mounted
 * (App Router only serves routes under `src/app/api`).
 *
 * The tables are created on first use with `exec_sql` (the same idempotent
 * provisioning the clinic queue uses) so the feature works on day one without
 * anybody having to remember to run a migration file. If `exec_sql` is not
 * available — a locked-down database, a service key without the helper — the
 * store degrades to `app_settings`, which is proven present in production.
 * That fallback is a safety net, not the target: it stores the list as JSON
 * and is not appropriate for scale, but it means a list is NEVER silently
 * dropped because a table was missing.
 *
 * ── The money rule ────────────────────────────────────────────────────────
 * The shopping service fee is UGX 500 per VALID ITEM and is computed on the
 * SERVER from the number of validated items. The client never sends a total
 * and the server never trusts one. Merchandise and delivery are tracked
 * separately and are only ever added on top of the shopping fee.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStoredValue } from "@/lib/welcome-bg-server";
import {
  SHOPPING_FEE_PER_ITEM_UGX,
  SHOPPING_LIST_MAX_ITEMS,
  validateShoppingList,
  type ShoppingItem,
  type ShoppingListStatus,
} from "@/lib/shopping-list";

type Sb = SupabaseClient<any, any, any>;

/** Storage key used by the `app_settings` fallback. */
const FALLBACK_KEY = "shopping-lists:v1";

export const SHOPPING_LIST_STATUSES: ShoppingListStatus[] = [
  "draft",
  "submitted",
  "shopping",
  "awaiting_approval",
  "confirmed",
  "assigned",
  "delivering",
  "delivered",
  "cancelled",
];

/** Statuses staff may move a list into, and who may do it. */
const STAFF_TRANSITIONS: Record<string, ShoppingListStatus[]> = {
  submitted: ["shopping", "cancelled"],
  shopping: ["awaiting_approval", "confirmed", "cancelled"],
  awaiting_approval: ["confirmed", "shopping", "cancelled"],
  confirmed: ["assigned", "cancelled"],
  assigned: ["delivering", "cancelled"],
  delivering: ["delivered"],
  delivered: [],
  cancelled: [],
  draft: ["submitted", "cancelled"],
};

/** A list row as the database stores it. */
export type ShoppingListRow = {
  id: string;
  customer_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  name: string;
  status: ShoppingListStatus;
  items: ShoppingItem[];
  shopping_fee_ugx: number;
  merchandise_ugx: number;
  delivery_fee_ugx: number;
  total_ugx: number;
  notes: string | null;
  merchant_id: string | null;
  rider_id: string | null;
  created_at: string;
  updated_at: string;
};

let SCHEMA_READY: Promise<void> | null = null;

/**
 * Create the shopping list tables if they are missing.
 * Idempotent, and every statement is `IF NOT EXISTS`, so it is safe to run on
 * every request. Errors are swallowed: the caller falls back to
 * `app_settings` when the tables are not there.
 */
export function ensureShoppingListSchema(sb: Sb): Promise<void> {
  if (!SCHEMA_READY) {
    SCHEMA_READY = (async () => {
      try {
        await sb.rpc("exec_sql", {
          query: `
            CREATE TABLE IF NOT EXISTS shopping_lists (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              customer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
              customer_email TEXT,
              customer_name TEXT,
              name TEXT NOT NULL DEFAULT 'GoDoor Shopping List',
              status TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('draft','submitted','shopping','awaiting_approval','confirmed','assigned','delivering','delivered','cancelled')),
              items JSONB NOT NULL DEFAULT '[]'::jsonb,
              shopping_fee_ugx INTEGER NOT NULL DEFAULT 0,
              merchandise_ugx INTEGER NOT NULL DEFAULT 0,
              delivery_fee_ugx INTEGER NOT NULL DEFAULT 0,
              total_ugx INTEGER NOT NULL DEFAULT 0,
              notes TEXT,
              merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
              rider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS shopping_list_events (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
              actor_role TEXT NOT NULL,
              actor_id UUID,
              event TEXT NOT NULL,
              detail JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_shopping_lists_customer
              ON shopping_lists(customer_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_shopping_lists_status
              ON shopping_lists(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_shopping_list_events_list
              ON shopping_list_events(shopping_list_id, created_at DESC);

            ALTER TABLE shopping_lists ENABLE ROW LEVEL SECURITY;
            ALTER TABLE shopping_list_events ENABLE ROW LEVEL SECURITY;

            DO $$ BEGIN
              CREATE POLICY "Customers read own shopping lists" ON shopping_lists
                FOR SELECT USING (customer_id = auth.uid());
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            DO $$ BEGIN
              CREATE POLICY "Customers create own shopping lists" ON shopping_lists
                FOR INSERT WITH CHECK (customer_id = auth.uid());
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            DO $$ BEGIN
              CREATE POLICY "Customers update own shopping lists" ON shopping_lists
                FOR UPDATE USING (customer_id = auth.uid())
                WITH CHECK (customer_id = auth.uid());
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            DO $$ BEGIN
              CREATE POLICY "Customers read own list events" ON shopping_list_events
                FOR SELECT USING (
                  EXISTS (
                    SELECT 1 FROM shopping_lists sl
                    WHERE sl.id = shopping_list_events.shopping_list_id
                      AND sl.customer_id = auth.uid()
                  )
                );
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          `,
        });
      } catch {
        // Fall back to app_settings below.
      }
    })();
  }
  return SCHEMA_READY;
}

/** Test seam — forget the schema bootstrap so a suite can re-run it. */
export function __resetShoppingListSchema(): void {
  SCHEMA_READY = null;
}

/* ────────────────────────────── app_settings fallback ────────────────────── */

async function fallbackRead(sb: Sb): Promise<ShoppingListRow[]> {
  const { data, error } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", FALLBACK_KEY)
    .maybeSingle();
  if (error || !data?.value) return [];
  // `app_settings.value` is a text column that has been written both ways over
  // time — sometimes as a JSON string, sometimes as a raw JSON value. Parsing
  // it with `JSON.parse(String(value))` turns an already-parsed array into
  // "[object Object]" and throws, silently emptying the whole store. The
  // shared reader accepts every shape that can legitimately be in the column.
  const parsed = parseStoredValue(data.value);
  return Array.isArray(parsed) ? (parsed as ShoppingListRow[]) : [];
}

async function fallbackWrite(sb: Sb, rows: ShoppingListRow[]): Promise<void> {
  try {
    await sb.from("app_settings").upsert(
      {
        key: FALLBACK_KEY,
        // Stored as a JSON *string*, matching every other row in the table.
        value: JSON.stringify(rows),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}
}

/* ──────────────────────────────── public API ─────────────────────────────── */

/** Does the database have the dedicated tables? */
async function tablesExist(sb: Sb): Promise<boolean> {
  try {
    const { error } = await sb.from("shopping_lists").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Lists owned by a customer (newest first). */
export async function listCustomerLists(sb: Sb, customerId: string): Promise<ShoppingListRow[]> {
  await ensureShoppingListSchema(sb);
  if (await tablesExist(sb)) {
    const { data, error } = await sb
      .from("shopping_lists")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) return data as ShoppingListRow[];
  }
  const all = await fallbackRead(sb);
  return all
    .filter((r) => r.customer_id === customerId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Every list, for the staff/admin queue. */
export async function listAllLists(sb: Sb, limit = 200): Promise<ShoppingListRow[]> {
  await ensureShoppingListSchema(sb);
  if (await tablesExist(sb)) {
    const { data, error } = await sb
      .from("shopping_lists")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error && data) return data as ShoppingListRow[];
  }
  const all = await fallbackRead(sb);
  return all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
}

/** One list by id, or null. */
export async function getList(sb: Sb, id: string): Promise<ShoppingListRow | null> {
  await ensureShoppingListSchema(sb);
  if (await tablesExist(sb)) {
    const { data, error } = await sb.from("shopping_lists").select("*").eq("id", id).maybeSingle();
    if (!error && data) return data as ShoppingListRow;
    if (error) return null;
  }
  const all = await fallbackRead(sb);
  return all.find((r) => r.id === id) ?? null;
}

export type CreateListInput = {
  id?: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  name?: string;
  notes?: string | null;
  rawItems: unknown;
};

/**
 * Create a shopping list.
 *
 * The item count and every fee are computed HERE, on the server, from the
 * validated items. Nothing the client claims about the total is read.
 */
export async function createList(
  sb: Sb,
  input: CreateListInput,
): Promise<
  | { ok: true; list: ShoppingListRow }
  | { ok: false; error: string; status: number; detail?: unknown }
> {
  const validation = validateShoppingList(input.rawItems);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      error: validation.errors[0] || "Shopping list is not valid",
      detail: validation,
    };
  }

  const items = validation.items.filter((r) => r.valid && r.item).map((r) => r.item!);
  const now = new Date().toISOString();
  const listName = (input.name || "GoDoor Shopping List").slice(0, 120);

  const row: ShoppingListRow = {
    id: input.id && isUuidLike(input.id) ? input.id : randomId(),
    customer_id: input.customerId,
    customer_email: input.customerEmail,
    customer_name: input.customerName,
    name: listName,
    status: "submitted",
    items,
    shopping_fee_ugx: validation.shoppingFeeUgx,
    merchandise_ugx: validation.merchandiseUgx,
    delivery_fee_ugx: 0,
    total_ugx: validation.shoppingFeeUgx + validation.merchandiseUgx,
    notes: input.notes ? String(input.notes).slice(0, 500) : null,
    merchant_id: null,
    rider_id: null,
    created_at: now,
    updated_at: now,
  };

  await ensureShoppingListSchema(sb);
  if (await tablesExist(sb)) {
    const { data, error } = await sb.from("shopping_lists").insert(row).select("*").maybeSingle();
    if (error) {
      // A duplicate id is the classic double-submit. Treat it as idempotent
      // rather than charging the customer twice.
      if (row.id && /duplicate key|already exists/i.test(error.message)) {
        const existing = await getList(sb, row.id);
        if (existing && existing.customer_id === input.customerId) {
          return { ok: true, list: existing };
        }
      }
      return { ok: false, status: 500, error: "Could not save your shopping list" };
    }
    await logEvent(sb, row.id, "customer", input.customerId, "submitted", {
      itemCount: items.length,
      shoppingFeeUgx: validation.shoppingFeeUgx,
    });
    return { ok: true, list: (data as ShoppingListRow) ?? row };
  }

  // Fallback storage
  const all = await fallbackRead(sb);
  all.push(row);
  await fallbackWrite(sb, all);
  return { ok: true, list: row };
}

export type UpdateListInput = {
  status?: ShoppingListStatus;
  notes?: string | null;
  merchantId?: string | null;
  riderId?: string | null;
  items?: ShoppingItem[];
  merchandiseUgx?: number;
  deliveryFeeUgx?: number;
  actorRole: "customer" | "staff" | "admin" | "rider";
  actorId: string | null;
};

/**
 * Update a list.
 *
 * Fees are recomputed from the server's own copy of the items every time, so
 * a client that tampers with `shoppingFeeUgx` cannot change the charge.
 */
export async function updateList(
  sb: Sb,
  id: string,
  input: UpdateListInput,
): Promise<
  | { ok: true; list: ShoppingListRow }
  | { ok: false; error: string; status: number }
> {
  const current = await getList(sb, id);
  if (!current) return { ok: false, status: 404, error: "Shopping list not found" };

  let items = current.items ?? [];
  if (input.items) {
    const validation = validateShoppingList(input.items);
    if (!validation.valid) {
      return { ok: false, status: 400, error: validation.errors[0] || "Items are not valid" };
    }
    items = validation.items.filter((r) => r.valid && r.item).map((r) => r.item!);
  }

  const validItemCount = items.length;
  const shoppingFeeUgx = validItemCount * SHOPPING_FEE_PER_ITEM_UGX;
  const merchandiseUgx =
    input.merchandiseUgx !== undefined
      ? Math.max(0, Math.trunc(input.merchandiseUgx))
      : items.reduce((s, i) => s + (i.unitPriceUgx ?? 0) * i.quantity, 0);
  const deliveryFeeUgx =
    input.deliveryFeeUgx !== undefined ? Math.max(0, Math.trunc(input.deliveryFeeUgx)) : current.delivery_fee_ugx;

  let status = current.status;
  if (input.status && input.status !== current.status) {
    if (input.actorRole === "customer") {
      // A customer may only cancel their own list, and only before it is
      // being shopped.
      if (input.status !== "cancelled") {
        return { ok: false, status: 403, error: "You cannot change the list status" };
      }
      if (!["draft", "submitted"].includes(current.status)) {
        return { ok: false, status: 403, error: "This list is already being processed" };
      }
    } else {
      const allowed = STAFF_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(input.status)) {
        return {
          ok: false,
          status: 409,
          error: `A ${current.status} list cannot become ${input.status}`,
        };
      }
    }
    status = input.status;
  }

  const patch: Partial<ShoppingListRow> = {
    items,
    status,
    shopping_fee_ugx: shoppingFeeUgx,
    merchandise_ugx: merchandiseUgx,
    delivery_fee_ugx: deliveryFeeUgx,
    total_ugx: shoppingFeeUgx + merchandiseUgx + deliveryFeeUgx,
    updated_at: new Date().toISOString(),
  };
  if (input.notes !== undefined) patch.notes = input.notes ? String(input.notes).slice(0, 500) : null;
  if (input.merchantId !== undefined) patch.merchant_id = input.merchantId;
  if (input.riderId !== undefined) patch.rider_id = input.riderId;

  await ensureShoppingListSchema(sb);
  if (await tablesExist(sb)) {
    const { data, error } = await sb.from("shopping_lists").update(patch).eq("id", id).select("*").maybeSingle();
    if (error) return { ok: false, status: 500, error: "Could not update the shopping list" };
    const updated = (data as ShoppingListRow) ?? { ...current, ...patch };
    await logEvent(sb, id, input.actorRole, input.actorId, status, { shoppingFeeUgx });
    return { ok: true, list: updated };
  }

  const all = await fallbackRead(sb);
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false, status: 404, error: "Shopping list not found" };
  all[idx] = { ...all[idx], ...patch };
  await fallbackWrite(sb, all);
  await logEvent(sb, id, input.actorRole, input.actorId, status, { shoppingFeeUgx });
  return { ok: true, list: all[idx] };
}

/** Cancel / delete a list the caller owns. */
export async function deleteList(
  sb: Sb,
  id: string,
  actorRole: "customer" | "staff" | "admin",
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const current = await getList(sb, id);
  if (!current) return { ok: false, status: 404, error: "Shopping list not found" };
  if (actorRole === "customer") {
    if (current.customer_id !== actorId) {
      return { ok: false, status: 403, error: "You do not own this shopping list" };
    }
    if (!["draft", "submitted"].includes(current.status)) {
      return { ok: false, status: 409, error: "This list is already being processed" };
    }
  }

  await ensureShoppingListSchema(sb);
  if (await tablesExist(sb)) {
    const { error } = await sb.from("shopping_lists").delete().eq("id", id);
    if (error) return { ok: false, status: 500, error: "Could not delete the shopping list" };
    await logEvent(sb, id, actorRole, actorId, "deleted", {});
    return { ok: true };
  }

  const all = await fallbackRead(sb);
  await fallbackWrite(sb, all.filter((r) => r.id !== id));
  return { ok: true };
}

/** Append an audit event. Never throws — auditing must not break a write. */
export async function logEvent(
  sb: Sb,
  listId: string,
  actorRole: string,
  actorId: string | null,
  event: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("shopping_list_events").insert({
      shopping_list_id: listId,
      actor_role: actorRole,
      actor_id: actorId,
      event,
      detail,
    });
  } catch {}
}

/** The audit trail for one list. */
export async function listEvents(
  sb: Sb,
  listId: string,
): Promise<Array<{ event: string; actor_role: string; detail: unknown; created_at: string }>> {
  try {
    const { data, error } = await sb
      .from("shopping_list_events")
      .select("event, actor_role, detail, created_at")
      .eq("shopping_list_id", listId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) return data as never;
  } catch {}
  return [];
}

/* ───────────────────────────────── helpers ───────────────────────────────── */

/** A client-supplied id is only honoured when it looks like a UUID. */
function isUuidLike(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** A v4 UUID, for rows created server-side. */
function randomId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export { SHOPPING_LIST_MAX_ITEMS };
