"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Clock, ShoppingBag, ArrowRight, AlertTriangle } from "lucide-react";
import { fetchOrders, fetchMerchantById, fetchProducts, type DBOrder, type ReorderLine } from "@/lib/db";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session-store";
import { formatUgx } from "@/lib/utils";

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString("en-UG", { day: "numeric", month: "short" });
}

/** Fallback parser for legacy orders that predate structured line_items. */
function parseLegacyItems(
  raw: string,
  subtotal = 0,
): { name: string; qty: number; unitPrice: number }[] {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .map((i: Record<string, unknown>) => ({
          name: String(i.name ?? ""),
          qty: Number(i.quantity ?? i.qty ?? 1) || 1,
          unitPrice: Number(i.unitPrice ?? i.unitPriceUgx ?? i.price ?? 0) || 0,
        }))
        .filter((i) => i.name);
    }
  } catch {}

  const items = String(raw)
    .split(",")
    .map((part) => {
      const m = part.trim().match(/^(.*?)\s*×\s*(\d+)$/);
      return m
        ? { name: m[1].trim().replace(/\s*\[heavy\]$/i, ""), qty: parseInt(m[2], 10), unitPrice: 0 }
        : { name: part.trim(), qty: 1, unitPrice: 0 };
    })
    .filter((i) => i.name);
  if (items.length === 0 || !subtotal) return items;
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  return items.map((i) => ({
    ...i,
    unitPrice: Math.round(subtotal * (i.qty / totalQty) / i.qty),
  }));
}

type ReorderResult = { ok: boolean; text: string };

export function QuickReorder() {
  const router = useRouter();
  const [orders, setOrders] = useState<DBOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReorderResult | null>(null);
  const add = useCart((s) => s.add);
  const cartCount = useCart((s) => s.count());
  const profile = useSession((s) => s.profile);
  const email = profile?.email;

  const load = useCallback(async () => {
    try {
      const all = await fetchOrders({ customer_email: email });
      const past = all
        .filter((o) => o.status && o.status !== "cancelled")
        .slice(0, 5);
      setOrders(past);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    load();
  }, [load]);

  const reorderLines = useCallback(
    (order: DBOrder, products: { id: string; name: string; price: number; available: boolean; bulky?: boolean; merchant_id: string }[]) => {
      const skips: string[] = [];
      const priceNotes: string[] = [];
      let added = 0;

      const pushLine = (productId: string, name: string, unitPriceUgx: number, quantity: number, bulky: boolean, paidPrice?: number) => {
        if (paidPrice !== undefined && paidPrice !== unitPriceUgx) {
          priceNotes.push(`${name} is now ${formatUgx(unitPriceUgx)}`);
        }
        add({ productId, merchantId: order.merchant_id, name, unitPriceUgx, quantity, bulky });
        added += quantity;
      };

      const resolve = (line: ReorderLine) => {
        const p = products.find((x) => x.id === line.productId);
        if (!p || p.available === false) {
          skips.push(`${p?.name || line.name} is no longer available`);
          return;
        }
        pushLine(p.id, p.name, p.price, line.quantity, p.bulky === true, line.unitPriceUgx);
      };

      if (Array.isArray(order.line_items) && order.line_items.length > 0) {
        for (const line of order.line_items) resolve(line);
      } else {
        // Legacy order: parse the display string, match by name where possible.
        const items = parseLegacyItems(order.items, order.subtotal_ugx);
        for (const it of items) {
          const p = products.find((x) => x.name.toLowerCase() === it.name.toLowerCase());
          if (p && p.available !== false) {
            pushLine(p.id, p.name, p.price, it.qty, p.bulky === true, it.unitPrice || undefined);
          } else if (p) {
            skips.push(`${it.name} is no longer available`);
          } else {
            pushLine(`${order.id}-${it.name}`, it.name, it.unitPrice || 0, it.qty, false);
          }
        }
      }

      return { added, skips: skips.slice(0, 3), priceNotes: priceNotes.slice(0, 2) };
    },
    [add],
  );

  const handleReorder = useCallback(
    async (order: DBOrder) => {
      if (busyId) return;
      setBusyId(order.id);
      setNotice(null);
      try {
        const merchant = await fetchMerchantById(order.merchant_id);
        if (!merchant || merchant.status !== "active") {
          setNotice({ ok: false, text: `${order.merchant_name} is no longer accepting orders.` });
          return;
        }
        const products = await fetchProducts(order.merchant_id);
        const { added, skips, priceNotes } = reorderLines(order, products as { id: string; name: string; price: number; available: boolean; bulky?: boolean; merchant_id: string }[]);

        if (added === 0) {
          setNotice({ ok: false, text: skips.length ? `${skips.join(". ")}.` : "Nothing from this order can be reordered right now." });
          return;
        }
        const notes = [...priceNotes, ...skips];
        setNotice({
          ok: true,
          text: `${added} item${added > 1 ? "s" : ""} added to cart.${notes.length ? " " + notes.join(". ") + "." : ""}`,
        });
        setTimeout(() => router.push("/cart"), 750);
      } catch {
        setNotice({ ok: false, text: "Couldn't reorder. Please add items from the menu instead." });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, reorderLines, router],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
        <Clock size={16} className="animate-spin" />
        Loading recent orders…
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated">
          <ShoppingBag size={24} className="text-dim" />
        </div>
        <p className="text-sm font-medium text-muted">
          No orders yet — start ordering!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-dim">
          Reorder
        </h3>
        {cartCount > 0 && (
          <Link
            href="/cart"
            className="inline-flex items-center gap-1 text-xs font-semibold text-go transition hover:text-go-2"
          >
            View cart · {cartCount}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {notice && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs animate-fade-in ${
          notice.ok
            ? "border-success/25 bg-success/10 text-success"
            : "border-warning/30 bg-warning/10 text-warning"
        }`}>
          {!notice.ok && <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          <p>{notice.text}</p>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
        {orders.map((order) => {
          const items = Array.isArray(order.line_items) && order.line_items.length
            ? order.line_items.map((i) => i.name).join(", ")
            : parseLegacyItems(order.items).map((i) => i.name).join(", ");
          const isBusy = busyId === order.id;

          return (
            <div
              key={order.id}
              className="snap-start shrink-0 w-64 rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
            >
              <p className="truncate text-sm font-semibold text-fg">
                {order.merchant_name}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-muted">
                {items || "Order items"}
              </p>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-bold text-fg">
                  {formatUgx(order.total_ugx)}
                </span>
                <span className="text-[11px] text-dim">
                  {relativeDate(order.created_at)}
                </span>
              </div>

              <button
                onClick={() => handleReorder(order)}
                disabled={isBusy}
                className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition active:scale-95 ${
                  isBusy
                    ? "bg-go/15 text-go"
                    : "bg-go text-white hover:bg-go-2"
                }`}
              >
                <RefreshCw size={13} className={isBusy ? "animate-spin" : ""} />
                {isBusy ? "Reordering…" : "Reorder"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}