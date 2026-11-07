"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ShoppingBasket, Clock, CheckCircle2, X, AlertCircle, Phone,
  Navigation, Store, ChevronRight, Loader2, RefreshCw,
} from "lucide-react";
import { apiAuthHeaders } from "@/lib/db";
import { formatUgx, cn } from "@/lib/utils";

/* ── Types ──────────────────────────────────────────────────────────────── */

type GoMartItem = { name: string; quantity: number; preference?: string | null };

type GoMartList = {
  id: string;
  name: string;
  status: string;
  items: GoMartItem[];
  shopping_fee_ugx: number;
  rider_share_ugx: number;
  merchandise_ugx: number;
  delivery_fee_ugx: number;
  total_ugx: number;
  customer_id: string | null;
  customer_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/* ── Status labels ──────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "bg-go/10 text-go" },
  confirmed: { label: "Confirmed", cls: "bg-success/10 text-success" },
  shopping: { label: "Shopping", cls: "bg-brand-light text-brand-deep" },
  assigned: { label: "Assigned to you", cls: "bg-info/10 text-info" },
  delivering: { label: "Out for delivery", cls: "bg-info/10 text-info" },
  delivered: { label: "Delivered", cls: "bg-success/10 text-success" },
  cancelled: { label: "Cancelled", cls: "bg-danger/10 text-danger" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status.replace(/_/g, " "), cls: "bg-elevated text-muted" };
  return (
    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", s.cls)}>
      {s.label}
    </span>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

export function RiderGoMartPanel({ onNewOpen }: { onNewOpen?: (count: number) => void } = {}) {
  const [open, setOpen] = useState<GoMartList[]>([]);
  const [mine, setMine] = useState<GoMartList[]>([]);
  const [history, setHistory] = useState<GoMartList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [actualCost, setActualCost] = useState<Record<string, string>>({});
  const [chatText, setChatText] = useState<Record<string, string>>({});
  const [chatMessages, setChatMessages] = useState<Record<string, Array<{ id: string; sender_name: string; sender_role: string; text: string; kind: string; amount_ugx?: number | null; created_at: string }>>>({});

  const load = useCallback(() => {
    return (async () => {
      try {
        const res = await fetch("/api/rider/gomart", {
          cache: "no-store",
          headers: await apiAuthHeaders(false),
        });
        if (!res.ok) {
          let msg = "Could not load GoMart lists";
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {}
          throw new Error(msg);
        }
        const data = await res.json();
        const openList = Array.isArray(data.open) ? data.open : [];
        setOpen(openList);
        onNewOpen?.(openList.length);
        setMine(Array.isArray(data.mine) ? data.mine : []);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load GoMart lists");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function claim(listId: string) {
    setClaimingId(listId);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await fetch("/api/rider/gomart", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ listId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        // 409 = another rider won the race. Not a failure — surface the
        // server message and refresh so the card disappears off the board.
        const msg = json.error || "Could not claim this list";
        setActionError(msg);
        void load();
        return;
      }
      setActionOk("List claimed — start shopping when you're ready.");
      void load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error. Try again.");
    } finally {
      setClaimingId(null);
    }
  }

  /** Move a claimed list through its lifecycle (assigned → shopping → delivering → delivered). */
  async function advance(listId: string, next: "shopping" | "delivering" | "delivered") {
    setActingId(listId);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await fetch(`/api/shopping-list/${encodeURIComponent(listId)}`, {
        method: "PATCH",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setActionError(json.error || "Could not update this list");
        return;
      }
      setActionOk(
        next === "shopping"
          ? "Shopping started — a shopper is on your list."
          : next === "delivering"
            ? "Out for delivery."
            : "Delivered. You earned the runner share.",
      );
      void load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Network error. Try again.");
    } finally {
      setActingId(null);
    }
  }

  const activeMine = mine.find((l) => ["assigned", "shopping", "delivering"].includes(l.status));

  // Chat poll for active job (rider ↔ customer negotiation).
  useEffect(() => {
    if (!activeMine) return;
    const listId = activeMine.id;
    const loadChat = async () => {
      try {
        const res = await fetch(`/api/shopping-list/messages?id=${encodeURIComponent(listId)}`, {
          cache: "no-store",
          headers: await apiAuthHeaders(false),
        });
        if (!res.ok) return;
        const data = await res.json();
        setChatMessages((prev) => ({ ...prev, [listId]: data.messages ?? [] }));
      } catch {}
    };
    void loadChat();
    const id = setInterval(() => {
      if (!document.hidden) void loadChat();
    }, 5000);
    return () => clearInterval(id);
  }, [activeMine?.id]);

  return (
    <div className="px-4 pt-4 pb-6 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-go/10 text-go">
          🛒
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-fg">GoMart jobs</h2>
          <p className="text-[11px] text-muted">Customer shopping lists — shop them and deliver</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh GoMart board"
          className="grid h-9 w-9 place-items-center rounded-full bg-elevated text-muted transition hover:text-fg"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 flex items-start gap-2">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs text-danger">{actionError}</p>
        </div>
      )}
      {actionOk && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/10 px-3.5 py-2.5 flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="text-xs text-success">{actionOk}</p>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl bg-bg px-3.5 py-3 ring-1 ring-border/50">
        <p className="text-[11px] leading-relaxed text-muted">
          <span className="font-semibold text-fg">Runner fee:</span> flat {formatUgx(3000)} UGX (6,000 with an
          extra stop). You earn <span className="font-semibold text-success">65%</span> of it — the customer
          pays the items separately after you shop.
        </p>
      </div>

      {/* Active (claimed by this rider) */}
      {activeMine && (
        <div className="rounded-2xl border border-go/30 bg-go/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-go">Your GoMart job</p>
              <p className="mt-1 text-sm font-semibold text-fg">{activeMine.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {activeMine.items.length} items · {activeMine.customer_name}
              </p>
            </div>
            <StatusPill status={activeMine.status} />
          </div>

          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-bg">
            {activeMine.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{it.name}</span>
                <span className="shrink-0 text-xs text-muted">× {it.quantity}</span>
              </li>
            ))}
          </ul>

          {activeMine.notes && (
            <p className="mt-2 text-xs italic text-muted">“{activeMine.notes}”</p>
          )}

          <dl className="mt-3 space-y-1 rounded-xl bg-bg px-3 py-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Runner fee</dt>
              <dd className="font-semibold tabular-nums text-fg">{formatUgx(activeMine.shopping_fee_ugx)} UGX</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">You earn (65%)</dt>
              <dd className="font-bold tabular-nums text-success">{formatUgx(activeMine.rider_share_ugx)} UGX</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Customer estimate</dt>
              <dd className="font-semibold tabular-nums text-fg">{formatUgx(activeMine.merchandise_ugx)} UGX</dd>
            </div>
          </dl>

          {/* Post actual cost → chat negotiation */}
          <div className="mt-3 rounded-xl border border-border bg-bg p-3">
            <label className="text-[11px] font-semibold text-fg" htmlFor={`actual-${activeMine.id}`}>
              Actual items cost (UGX) — after shopping
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id={`actual-${activeMine.id}`}
                value={actualCost[activeMine.id] ?? ""}
                onChange={(e) => setActualCost((p) => ({ ...p, [activeMine.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                inputMode="numeric"
                placeholder="e.g. 45000"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm tabular-nums"
              />
              <button
                type="button"
                disabled={actingId === activeMine.id || !(actualCost[activeMine.id] ?? "").trim()}
                onClick={async () => {
                  const amt = Number(actualCost[activeMine.id]);
                  if (!amt || amt <= 0) return;
                  setActingId(activeMine.id);
                  try {
                    const res = await fetch(`/api/shopping-list/${encodeURIComponent(activeMine.id)}`, {
                      method: "PATCH",
                      headers: await apiAuthHeaders(true),
                      body: JSON.stringify({ actualMerchandiseUgx: amt }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || !json.success) throw new Error(json.error || "Could not post cost");
                    setActionOk(`Actual cost posted: ${formatUgx(amt)} UGX. Customer can approve or add funds.`);
                    setActualCost((p) => ({ ...p, [activeMine.id]: "" }));
                    void load();
                  } catch (e) {
                    setActionError(e instanceof Error ? e.message : "Could not post cost");
                  } finally {
                    setActingId(null);
                  }
                }}
                className="rounded-lg bg-go px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Post cost
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">Above the estimate? The customer can add extra funds from chat.</p>
          </div>

          {/* Rider ↔ customer chat */}
          <div className="mt-3 rounded-xl border border-border bg-bg p-3">
            <p className="text-[11px] font-semibold text-fg">Chat with customer</p>
            <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto">
              {(chatMessages[activeMine.id] ?? []).length === 0 ? (
                <p className="text-[11px] text-muted">No messages yet.</p>
              ) : (
                (chatMessages[activeMine.id] ?? []).map((m) => (
                  <div key={m.id} className="text-xs">
                    <span className="font-semibold text-fg">{m.sender_name}</span>
                    <span className="ml-1 text-[10px] text-dim">{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <p className="mt-0.5 text-muted">{m.text}</p>
                    {m.amount_ugx != null && <p className="text-[11px] font-semibold text-go">{formatUgx(m.amount_ugx)} UGX</p>}
                  </div>
                ))
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={chatText[activeMine.id] ?? ""}
                onChange={(e) => setChatText((p) => ({ ...p, [activeMine.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const text = (chatText[activeMine.id] ?? "").trim();
                  if (!text) return;
                  void (async () => {
                    try {
                      const res = await fetch("/api/shopping-list/messages", {
                        method: "POST",
                        headers: await apiAuthHeaders(true),
                        body: JSON.stringify({ listId: activeMine.id, text, kind: "chat" }),
                      });
                      if (!res.ok) throw new Error("Message failed");
                      setChatText((p) => ({ ...p, [activeMine.id]: "" }));
                      const r2 = await fetch(`/api/shopping-list/messages?id=${encodeURIComponent(activeMine.id)}`, {
                        cache: "no-store",
                        headers: await apiAuthHeaders(false),
                      });
                      if (r2.ok) {
                        const d = await r2.json();
                        setChatMessages((prev) => ({ ...prev, [activeMine.id]: d.messages ?? [] }));
                      }
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Message failed");
                    }
                  })();
                }}
                placeholder="Message customer…"
                aria-label="Message customer"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!(chatText[activeMine.id] ?? "").trim()}
                onClick={async () => {
                  const text = (chatText[activeMine.id] ?? "").trim();
                  if (!text) return;
                  try {
                    const res = await fetch("/api/shopping-list/messages", {
                      method: "POST",
                      headers: await apiAuthHeaders(true),
                      body: JSON.stringify({ listId: activeMine.id, text, kind: "chat" }),
                    });
                    if (!res.ok) throw new Error("Message failed");
                    setChatText((p) => ({ ...p, [activeMine.id]: "" }));
                    const r2 = await fetch(`/api/shopping-list/messages?id=${encodeURIComponent(activeMine.id)}`, {
                      cache: "no-store",
                      headers: await apiAuthHeaders(false),
                    });
                    if (r2.ok) {
                      const d = await r2.json();
                      setChatMessages((prev) => ({ ...prev, [activeMine.id]: d.messages ?? [] }));
                    }
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : "Message failed");
                  }
                }}
                className="rounded-lg bg-go px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {activeMine.status === "assigned" && (
              <button
                type="button"
                onClick={() => advance(activeMine.id, "shopping")}
                disabled={actingId === activeMine.id}
                className="btn col-span-2 bg-primary text-white hover:bg-primary-2 disabled:opacity-60"
              >
                {actingId === activeMine.id ? "Working…" : (<><Store className="h-3.5 w-3.5" /> Start shopping</>)}
              </button>
            )}
            {activeMine.status === "shopping" && (
              <button
                type="button"
                onClick={() => advance(activeMine.id, "delivering")}
                disabled={actingId === activeMine.id}
                className="btn col-span-2 bg-primary text-white hover:bg-primary-2 disabled:opacity-60"
              >
                {actingId === activeMine.id ? "Working…" : (<><Navigation className="h-3.5 w-3.5" /> Out for delivery</>)}
              </button>
            )}
            {activeMine.status === "delivering" && (
              <button
                type="button"
                onClick={() => advance(activeMine.id, "delivered")}
                disabled={actingId === activeMine.id}
                className="btn col-span-2 bg-success text-white hover:bg-success/90 disabled:opacity-60"
              >
                {actingId === activeMine.id ? "Working…" : (<><CheckCircle2 className="h-3.5 w-3.5" /> Delivered</>)}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Open jobs */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-sm font-semibold">Shopping lists waiting {open.length > 0 && <span className="text-muted">({open.length})</span>}</h3>
        <span className="flex items-center gap-1 text-[10px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Live
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : open.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
          <ShoppingBasket className="mx-auto h-7 w-7 text-dim" />
          <p className="mt-2 text-sm font-medium">No GoMart lists waiting</p>
          <p className="text-xs text-muted">
            {activeMine ? "Finish your current job — a new list will be claimable next." : "Customer shopping lists appear here instantly."}
          </p>
        </div>
      ) : (
        open.map((l) => (
          <div key={l.id} className="tile shadow-xs p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug truncate">{l.customer_name}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted">
                  {l.items.length} items · {l.items.slice(0, 3).map((it) => it.name).join(", ")}
                  {l.items.length > 3 ? "…" : ""}
                </p>
                {l.notes && <p className="mt-1 text-[11px] italic text-dim line-clamp-2">“{l.notes}”</p>}
                <p className="num mt-1 text-[10px] text-dim whitespace-nowrap flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(l.created_at).toLocaleString()}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="num text-lg font-bold text-success">{formatUgx(l.rider_share_ugx)}</p>
                <p className="text-[10px] text-dim">you earn · {formatUgx(l.shopping_fee_ugx)} total</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => claim(l.id)}
              disabled={claimingId === l.id || Boolean(activeMine)}
              className="btn mt-3 w-full bg-primary text-white hover:bg-primary-2 disabled:opacity-55"
            >
              {claimingId === l.id ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Claiming…</>
              ) : activeMine ? (
                <>Finish your current job first</>
              ) : (
                <>Claim this list <ChevronRight className="h-3.5 w-3.5" /></>
              )}
            </button>
          </div>
        ))
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            GoMart history ({history.length})
          </h3>
          {history.map((l) => (
            <div key={l.id} className="tile shadow-xs flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{l.customer_name} · {l.items.length} items</p>
                <p className="num text-[10px] text-dim">#{l.id.slice(-6)} · {new Date(l.updated_at).toLocaleDateString()}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="num text-xs font-bold text-success">+{formatUgx(l.rider_share_ugx)}</p>
                <StatusPill status={l.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Call customer hint when carrying */}
      {activeMine && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <Phone className="h-3 w-3 shrink-0" />
          Call the customer from the order chat once you start shopping — name shown on the list.
        </p>
      )}
    </div>
  );
}
