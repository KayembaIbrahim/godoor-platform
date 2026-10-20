"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Loader2,
  Minus,
  Plus,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUgx } from "@/lib/shopping-list";
import type { ShoppingItem, ShoppingListStatus } from "@/lib/shopping-list";

/**
 * Customer Shopping List — version 10.5.1.
 *
 * What changed from the previous 246-line form:
 *   • every item has a real quantity (not always 1), shown next to its cost;
 *   • the fee breakdown is visible BEFORE submitting: UGX 500 per valid item
 *     for the shopping service, merchandise, and delivery are three separate
 *     lines that are never folded together;
 *   • the fee is RECOMPUTED by the server on submit — the client sends items,
 *     never a total, so a tampered total cannot change the charge;
 *   • a list that is already being shopped can no longer be silently edited;
 *   • the activity trail shows how a list got where it is.
 */

const FEE_PER_ITEM = 500;
const MIN_ITEMS = 5;
const MAX_ITEMS = 100;

/** The row shape the API returns (snake_case columns from Postgres). */
type ListRow = {
  id: string;
  name: string;
  status: ShoppingListStatus;
  items: ShoppingItem[];
  shopping_fee_ugx: number;
  merchandise_ugx: number;
  delivery_fee_ugx: number;
  total_ugx: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

type DraftItem = { key: string; name: string; quantity: number };

export default function ShoppingListPage() {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [itemName, setItemName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch("/api/shopping-list", { cache: "no-store" });
      if (!res.ok) throw new Error(await friendlyError(res));
      const data = (await res.json()) as { shoppingLists?: ListRow[] };
      const rows = data.shoppingLists ?? [];
      setLists(rows);
      setActiveId((cur) => (cur && rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your shopping list");
    } finally {
      setLoading(false);
    }
  }

  function flash(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 3600);
  }

  function addItem() {
    const name = itemName.trim();
    if (!name) return;
    if (draft.length >= MAX_ITEMS) {
      flash("err", `A list can hold at most ${MAX_ITEMS} items.`);
      return;
    }
    setDraft((d) => [...d, { key: `${Date.now()}-${d.length}`, name, quantity: 1 }]);
    setItemName("");
  }

  function changeQty(key: string, delta: number) {
    setDraft((d) =>
      d.map((it) =>
        it.key === key
          ? { ...it, quantity: Math.max(1, Math.min(99, it.quantity + delta)) }
          : it,
      ),
    );
  }

  function removeItem(key: string) {
    setDraft((d) => d.filter((it) => it.key !== key));
  }

  const draftShoppingFee = draft.length * FEE_PER_ITEM;
  const draftMerchandise = draft.reduce((s, it) => s + FEE_PER_ITEM * it.quantity, 0);
  const draftTotal = draftShoppingFee + draftMerchandise;
  const remaining = Math.max(0, MIN_ITEMS - draft.length);

  async function submit() {
    if (draft.length < MIN_ITEMS) {
      flash("err", `Add ${remaining} more item${remaining === 1 ? "" : "s"} — a list needs at least ${MIN_ITEMS}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shopping-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: draft.map((it) => ({ name: it.name, quantity: it.quantity })),
        }),
      });
      if (!res.ok) throw new Error(await friendlyError(res));
      const data = (await res.json()) as { data?: ListRow };
      if (data.data) {
        setLists((l) => [data.data!, ...l]);
        setActiveId(data.data.id);
      }
      setDraft([]);
      flash("ok", "Shopping list submitted. We will start shopping shortly.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the list");
    } finally {
      setBusy(false);
    }
  }

  async function cancelList(id: string) {
    if (!window.confirm("Cancel this shopping list?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shopping-list/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await friendlyError(res));
      setLists((l) => l.filter((r) => r.id !== id));
      setActiveId((cur) => (cur === id ? null : cur));
      flash("ok", "Shopping list cancelled.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the list");
    } finally {
      setBusy(false);
    }
  }

  const active = lists.find((l) => l.id === activeId) ?? null;

  return (
    <div className="min-h-[100dvh] bg-bg pb-24">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-go/10 text-go">
              <ShoppingBasket className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold leading-tight text-fg">Shopping List</h1>
              <p className="truncate text-xs leading-tight text-muted">
                {formatUgx(FEE_PER_ITEM)} UGX service fee per item
              </p>
            </div>
          </div>
          {lists.length > 0 && (
            <div className="relative shrink-0">
              <select
                value={activeId ?? ""}
                onChange={(e) => setActiveId(e.target.value || null)}
                aria-label="Choose a shopping list"
                className="appearance-none rounded-xl border border-border bg-surface py-2 pl-3 pr-8 text-xs font-medium text-fg focus:border-go focus:outline-none focus:ring-2 focus:ring-go/30"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {statusLabel(l.status)} · {formatUgx(l.total_ugx)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {/* ── Composer ──────────────────────────────────────────────────── */}
        <section className="card p-4 sm:p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-fg">New shopping list</h2>
            <span
              className={cn(
                "text-xs font-medium",
                draft.length >= MIN_ITEMS ? "text-success" : "text-muted",
              )}
            >
              {draft.length} / {MAX_ITEMS}
            </span>
          </div>

          {/* Add row */}
          <div className="flex gap-2">
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder="Item name — e.g. 2 litres of milk"
              aria-label="Item name"
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-fg placeholder:text-muted focus:border-go focus:outline-none focus:ring-2 focus:ring-go/25"
            />
            <button
              type="button"
              onClick={addItem}
              disabled={!itemName.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 active:scale-[0.98] disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>

          {/* Items */}
          {draft.length > 0 && (
            <ul className="mt-3 space-y-2">
              {draft.map((it) => (
                <li
                  key={it.key}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{it.name}</p>
                    <p className="text-xs text-muted">
                      {formatUgx(FEE_PER_ITEM)} UGX per item
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-bg">
                    <button
                      type="button"
                      onClick={() => changeQty(it.key, -1)}
                      disabled={it.quantity <= 1}
                      aria-label={`Reduce quantity of ${it.name}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:text-fg disabled:opacity-30"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums text-fg">
                      {it.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => changeQty(it.key, 1)}
                      disabled={it.quantity >= 99}
                      aria-label={`Increase quantity of ${it.name}`}
                      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:text-fg disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    aria-label={`Remove ${it.name}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Minimum rule */}
          {draft.length < MIN_ITEMS && (
            <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs font-medium text-warning">
              Add {remaining} more item{remaining === 1 ? "" : "s"} — a shopping list starts at{" "}
              {MIN_ITEMS} items.
            </p>
          )}

          {/* Breakdown */}
          {draft.length > 0 && (
            <dl className="mt-4 space-y-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted">
                  Shopping service ({draft.length} × {formatUgx(FEE_PER_ITEM)})
                </dt>
                <dd className="font-semibold tabular-nums text-fg">{formatUgx(draftShoppingFee)} UGX</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted">Items estimate</dt>
                <dd className="font-semibold tabular-nums text-fg">{formatUgx(draftMerchandise)} UGX</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd className="text-xs text-muted">quoted after shopping</dd>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
                <dt className="font-semibold text-fg">Total so far</dt>
                <dd className="text-base font-bold tabular-nums text-go">
                  {formatUgx(draftTotal)} UGX
                </dd>
              </div>
            </dl>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={draft.length < MIN_ITEMS || busy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-go px-5 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBasket className="h-4 w-4" />}
            {busy ? "Submitting…" : "Submit shopping list"}
          </button>
          <p className="mt-2 text-center text-[11px] text-muted">
            We shop the list and deliver. You approve the final price before payment.
          </p>
        </section>

        {/* ── Active list ───────────────────────────────────────────────── */}
        {active && (
          <section className="card p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-fg">{active.name}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {active.items.length} items · {new Date(active.created_at).toLocaleDateString()}
                </p>
              </div>
              <StatusPill status={active.status} />
            </div>

            <ul className="divide-y divide-border rounded-xl border border-border">
              {active.items.map((it, i) => (
                <li key={it.id ?? `${it.name}-${i}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{it.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    × {it.quantity}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted">Shopping service</dt>
                <dd className="font-semibold tabular-nums text-fg">
                  {formatUgx(active.shopping_fee_ugx)} UGX
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted">Merchandise</dt>
                <dd className="font-semibold tabular-nums text-fg">
                  {formatUgx(active.merchandise_ugx)} UGX
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd className="font-semibold tabular-nums text-fg">
                  {formatUgx(active.delivery_fee_ugx)} UGX
                </dd>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
                <dt className="font-semibold text-fg">Total</dt>
                <dd className="text-base font-bold tabular-nums text-go">
                  {formatUgx(active.total_ugx)} UGX
                </dd>
              </div>
            </dl>

            {["submitted", "shopping", "awaiting_approval"].includes(active.status) && (
              <button
                type="button"
                onClick={() => cancelList(active.id)}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-danger/30 px-3.5 py-2 text-xs font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Cancel this list
              </button>
            )}

            <Activity listId={active.id} />
          </section>
        )}

        {/* ── History ───────────────────────────────────────────────────── */}
        {lists.length > 0 && (
          <section className="pb-2">
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Your lists
            </h2>
            <ul className="space-y-2">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(l.id)}
                    className={cn(
                      "card flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition",
                      l.id === activeId && "border-go/50 shadow-md",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">
                        {l.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {statusLabel(l.status)} · {l.items.length} items ·{" "}
                        {formatUgx(l.total_ugx)} UGX
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && lists.length === 0 && draft.length === 0 && (
          <p className="px-1 pb-6 text-center text-sm text-muted">
            No shopping lists yet. Add your first five items above.
          </p>
        )}
      </main>

      {/* ── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg",
            toast.kind === "ok" ? "bg-success" : "bg-danger",
          )}
        >
          {toast.msg}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger"
        >
          {error}
        </div>
      )}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: ShoppingListStatus }) {
  const map: Record<ShoppingListStatus, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-surface-2 text-muted" },
    submitted: { label: "Submitted", cls: "bg-go/10 text-go" },
    shopping: { label: "Being shopped", cls: "bg-brand-light text-brand-deep" },
    awaiting_approval: { label: "Awaiting approval", cls: "bg-warning/10 text-warning" },
    confirmed: { label: "Confirmed", cls: "bg-success/10 text-success" },
    assigned: { label: "Rider assigned", cls: "bg-info-light text-info" },
    delivering: { label: "Delivering", cls: "bg-info/10 text-info" },
    delivered: { label: "Delivered", cls: "bg-success/10 text-success" },
    cancelled: { label: "Cancelled", cls: "bg-danger/10 text-danger" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", s.cls)}>
      {s.label}
    </span>
  );
}

function statusLabel(status: ShoppingListStatus): string {
  const map: Record<ShoppingListStatus, string> = {
    draft: "Draft",
    submitted: "Submitted",
    shopping: "Being shopped",
    awaiting_approval: "Awaiting approval",
    confirmed: "Confirmed",
    assigned: "Rider assigned",
    delivering: "Delivering",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return map[status] ?? "Draft";
}

function Activity({ listId }: { listId: string }) {
  const [events, setEvents] = useState<Array<{ event: string; created_at: string }>>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/shopping-list/${encodeURIComponent(listId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { events?: Array<{ event: string; created_at: string }> };
        if (alive) setEvents(data.events ?? []);
      } catch {
        /* the trail is informational — never block the page on it */
      }
    })();
    return () => {
      alive = false;
    };
  }, [listId]);

  if (!events.length) return null;

  return (
    <details className="mt-3 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5">
      <summary className="cursor-pointer text-xs font-semibold text-muted">Activity</summary>
      <ul className="mt-2 space-y-1">
        {events.map((e, i) => (
          <li key={i} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-fg">{eventLabel(e.event)}</span>
            <span className="shrink-0 text-muted">
              {new Date(e.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function eventLabel(event: string): string {
  switch (event) {
    case "submitted":
      return "List submitted";
    case "shopping":
      return "A shopper started your list";
    case "awaiting_approval":
      return "Waiting for your approval";
    case "confirmed":
      return "Confirmed";
    case "assigned":
      return "Rider assigned";
    case "delivering":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    case "deleted":
      return "Removed";
    default:
      return event.replace(/_/g, " ");
  }
}

async function friendlyError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* fall through to the status text */
  }
  if (res.status === 401) return "Sign in to continue";
  return `Request failed (${res.status})`;
}
