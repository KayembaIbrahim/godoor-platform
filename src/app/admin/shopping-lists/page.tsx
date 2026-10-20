"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  PackageCheck,
  RefreshCw,
  Truck,
  User,
} from "lucide-react";
import { formatUgx } from "@/lib/shopping-list";
import type { ShoppingItem, ShoppingListStatus } from "@/lib/shopping-list";

/**
 * Staff queue for customer SHOPPING LISTS (version 10.5.1).
 *
 * The customer submits a list; a staff member shops it, records what the
 * items actually cost, and the list walks a state machine:
 *
 *   submitted → shopping → awaiting_approval → confirmed → assigned →
 *   delivering → delivered
 *
 * Every transition is validated on the SERVER (`STAFF_TRANSITIONS` in
 * `shopping-list-store.ts`), so this page cannot push a list into a state the
 * workflow does not allow — the buttons are a convenience, the server is the
 * rule.
 *
 * The money is recomputed server-side from the item list on every write. The
 * merchandise figure typed here is the CONFIRMED cost of the goods; the
 * UGX 500-per-item shopping service fee is added by the server on top and is
 * never editable here.
 */

type ListRow = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  name: string;
  status: ShoppingListStatus;
  items: ShoppingItem[];
  shopping_fee_ugx: number;
  merchandise_ugx: number;
  delivery_fee_ugx: number;
  total_ugx: number;
  notes: string | null;
  created_at: string;
};

/** The transitions this screen offers, by current status. */
const NEXT_ACTIONS: Record<string, Array<{ status: ShoppingListStatus; label: string }>> = {
  submitted: [
    { status: "shopping", label: "Start shopping" },
    { status: "cancelled", label: "Cancel" },
  ],
  shopping: [
    { status: "awaiting_approval", label: "Send for approval" },
    { status: "confirmed", label: "Confirm" },
    { status: "cancelled", label: "Cancel" },
  ],
  awaiting_approval: [
    { status: "confirmed", label: "Confirm" },
    { status: "shopping", label: "Back to shopping" },
    { status: "cancelled", label: "Cancel" },
  ],
  confirmed: [
    { status: "assigned", label: "Assign rider" },
    { status: "cancelled", label: "Cancel" },
  ],
  assigned: [
    { status: "delivering", label: "Out for delivery" },
    { status: "cancelled", label: "Cancel" },
  ],
  delivering: [{ status: "delivered", label: "Mark delivered" }],
  delivered: [],
  cancelled: [],
  draft: [{ status: "submitted", label: "Submit" }],
};

export default function AdminShoppingLists() {
  const router = useRouter();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<ShoppingListStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [merch, setMerch] = useState<Record<string, string>>({});
  const [delivery, setDelivery] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/shopping-list", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load shopping lists (${res.status})`);
      const data = (await res.json()) as { shoppingLists?: ListRow[] };
      setLists(data.shoppingLists ?? []);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load shopping lists" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(
    list: ListRow,
    status: ShoppingListStatus,
    extra: { merchandiseUgx?: number; deliveryFeeUgx?: number } = {},
  ) {
    setBusyId(list.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/shopping-list/${encodeURIComponent(list.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not update the list (${res.status})`);
      }
      const data = (await res.json()) as { data?: ListRow };
      if (data.data) {
        setLists((l) => l.map((r) => (r.id === data.data!.id ? data.data! : r)));
      }
      setMsg({ ok: true, text: `List moved to ${status.replace(/_/g, " ")}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setBusyId(null);
    }
  }

  const visible = filter === "all" ? lists : lists.filter((l) => l.status === filter);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
            <ClipboardList className="h-5 w-5 text-go" />
            Shopping Lists
          </h1>
          <p className="mt-1 text-sm text-muted">
            Customer shopping lists. The service fee is {formatUgx(500)} UGX per item and is
            calculated by the server — it cannot be edited here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-fg transition hover:bg-elevated"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {msg && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs ${
            msg.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
          }`}
        >
          {msg.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {msg.text}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {(["all", "submitted", "shopping", "awaiting_approval", "confirmed", "assigned", "delivering", "delivered"] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                filter === s
                  ? "bg-go text-white"
                  : "border border-border bg-surface text-muted hover:text-fg"
              }`}
            >
              {s === "all" ? "All" : s.replace(/_/g, " ")}
            </button>
          ),
        )}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No shopping lists {filter === "all" ? "yet" : `in "${filter.replace(/_/g, " ")}`}.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((l) => {
            const isOpen = expanded === l.id;
            const actions = NEXT_ACTIONS[l.status] ?? [];
            return (
              <li key={l.id} className="card overflow-hidden">
                {/* Summary */}
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : l.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-fg">
                      {l.customer_name || l.customer_email || "Customer"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {l.items.length} items · {formatUgx(l.total_ugx)} UGX ·{" "}
                      {new Date(l.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-go/10 px-2.5 py-1 text-[11px] font-semibold text-go">
                    {l.status.replace(/_/g, " ")}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-4 py-3.5">
                    {/* Items */}
                    <ul className="mb-3 space-y-1">
                      {l.items.map((it, i) => (
                        <li key={it.id ?? i} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 flex-1 truncate text-fg">
                            {it.name}
                            {it.preference ? (
                              <span className="text-xs text-muted"> ({it.preference})</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted">× {it.quantity}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Money */}
                    <dl className="mb-3 space-y-1 rounded-xl bg-surface-2 px-3 py-2.5 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-muted">Shopping service</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {formatUgx(l.shopping_fee_ugx)} UGX
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted">Merchandise</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {formatUgx(l.merchandise_ugx)} UGX
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted">Delivery</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {formatUgx(l.delivery_fee_ugx)} UGX
                        </dd>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1.5">
                        <dt className="font-semibold text-fg">Total</dt>
                        <dd className="font-bold tabular-nums text-go">{formatUgx(l.total_ugx)} UGX</dd>
                      </div>
                    </dl>

                    {/* Cost entry — staff only */}
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] font-medium text-muted">Merchandise (UGX)</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={merch[l.id] ?? String(l.merchandise_ugx)}
                          onChange={(e) => setMerch((m) => ({ ...m, [l.id]: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm tabular-nums focus:border-go focus:outline-none focus:ring-2 focus:ring-go/25"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-medium text-muted">Delivery (UGX)</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={delivery[l.id] ?? String(l.delivery_fee_ugx)}
                          onChange={(e) => setDelivery((d) => ({ ...d, [l.id]: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm tabular-nums focus:border-go focus:outline-none focus:ring-2 focus:ring-go/25"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={busyId === l.id}
                      onClick={() =>
                        void move(l, l.status, {
                          merchandiseUgx: Number(merch[l.id] ?? l.merchandise_ugx),
                          deliveryFeeUgx: Number(delivery[l.id] ?? l.delivery_fee_ugx),
                        })
                      }
                      className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-fg transition hover:bg-elevated disabled:opacity-50"
                    >
                      <PackageCheck className="h-3.5 w-3.5" /> Save costs
                    </button>

                    {/* Transitions */}
                    <div className="flex flex-wrap gap-1.5">
                      {actions.map((a) => (
                        <button
                          key={a.status}
                          type="button"
                          disabled={busyId === l.id}
                          onClick={() => void move(l, a.status)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                            a.status === "cancelled"
                              ? "border border-danger/30 text-danger hover:bg-danger/10"
                              : "bg-go text-white hover:bg-go-2"
                          }`}
                        >
                          {busyId === l.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : a.status === "assigned" ? (
                            <Truck className="h-3 w-3" />
                          ) : a.status === "delivered" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : a.status === "cancelled" ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <User className="h-3 w-3" />
                          )}
                          {a.label}
                        </button>
                      ))}
                    </div>

                    {l.notes && (
                      <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-muted">
                        Note: {l.notes}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-dim">
        Totals are recomputed on the server. The shopping service fee of {formatUgx(500)} UGX per
        valid item is derived from the item count and cannot be overridden here.
      </p>
      <button onClick={() => router.refresh()} className="hidden" aria-hidden="true" />
    </div>
  );
}
