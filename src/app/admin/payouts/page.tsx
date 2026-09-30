"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy, Check, TriangleAlert, RefreshCw, ShieldCheck, BanknoteArrowDown,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";

/**
 * Admin payouts.
 *
 * Built for speed at the till: one row per order, each party's Morse tag with a
 * single tap to copy, and the exact split (rider / business / platform) so
 * nothing has to be recalculated by hand.
 *
 * Read-only. This screen tells an operator who is owed what; it does not move
 * money. Refunds are recorded here and executed over Morse.
 */

type Party = { name: string; phone?: string | null; morse_tag?: string | null } | null;

type Row = {
  order_id: string;
  order_status: string;
  payment_status: string;
  escrowed: boolean;
  created_at: string;
  amounts: {
    subtotal_ugx: number;
    delivery_fee_ugx: number;
    service_fee_ugx: number;
    platform_fees_ugx: number;
    merchant_payout_ugx: number;
    rider_payout_ugx: number;
  };
  parties: { customer: Party; business: Party; rider: Party };
  payouts: { id: string; role: string; amount: number; status: string; paid_at: string | null }[];
  settled: boolean;
  refundable_to_wallet: boolean;
};

type Totals = {
  orders: number;
  unsettled: number;
  owed_merchant_ugx: number;
  owed_rider_ugx: number;
  platform_fees_ugx: number;
};

function CopyTag({ value, label }: { value?: string | null; label: string }) {
  const [done, setDone] = useState(false);
  if (!value) {
    return <span className="text-[10px] text-dim">no {label} tag</span>;
  }
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          // Clipboard blocked (insecure context / iframe) — the tag is still
          // visible on screen to copy by hand.
        }
      }}
      className="flex max-w-[9rem] items-center gap-1 rounded-md bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-fg transition hover:bg-navy hover:text-white"
      title={`Copy ${label} Morse tag`}
    >
      <span className="truncate">{value}</span>
      {done ? <Check className="h-3 w-3 shrink-0 text-success" /> : <Copy className="h-3 w-3 shrink-0 opacity-60" />}
    </button>
  );
}

function PartyRow({ role, party }: { role: string; party: Party }) {
  if (!party) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-dim">{role}</span>
        <span className="text-[11px] text-dim">unassigned</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-dim">{role}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{party.name}</span>
      <CopyTag value={party.morse_tag} label={role} />
    </div>
  );
}

export default function AdminPayoutsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [scope, setScope] = useState<"all" | "unsettled" | "settled">("unsettled");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/payouts?scope=${scope}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { rows?: Row[]; totals?: Totals }) => {
        setRows(d.rows ?? []);
        setTotals(d.totals ?? null);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load payouts"))
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  const missingTags = useMemo(
    () => rows.filter((r) => !r.settled && !r.parties.business?.morse_tag).length,
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">Payouts</h1>
        <div className="ml-auto flex items-center gap-1.5">
          {(["unsettled", "all", "settled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold capitalize transition ${
                scope === s ? "bg-go text-white" : "border border-border bg-surface text-muted"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={load}
            aria-label="Refresh"
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:text-fg"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Owed to business", value: totals.owed_merchant_ugx, tone: "text-go" },
            { label: "Owed to rider", value: totals.owed_rider_ugx, tone: "text-primary" },
            { label: "Platform fees", value: totals.platform_fees_ugx, tone: "text-success" },
            { label: "Unsettled orders", value: totals.unsettled, tone: "text-warning", count: true },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-border bg-surface p-3">
              <p className="text-[10px] uppercase tracking-wider text-dim">{c.label}</p>
              <p className={`mt-0.5 font-display text-base font-bold tabular-nums ${c.tone}`}>
                {c.count ? c.value : formatUgx(c.value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {missingTags > 0 && (
        <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 p-3 text-[11px] text-warning">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {missingTags} order{missingTags === 1 ? "" : "s"} on this list {missingTags === 1 ? "has" : "have"} no
          business Morse tag. Pay those over MoMo, or ask the business to set a tag in Account.
        </p>
      )}

      {err && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">{err}</p>
      )}

      {loading && rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Loading payouts…</p>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nothing in this view.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.order_id}
              className={`rounded-2xl border p-3.5 ${
                r.settled ? "border-border bg-surface/60" : "border-border bg-surface"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-muted">
                  #{r.order_id.slice(-6)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    r.settled
                      ? "bg-success/15 text-success"
                      : r.order_status === "cancelled"
                        ? "bg-danger/15 text-danger"
                        : "bg-warning/15 text-warning"
                  }`}
                >
                  {r.settled ? "Paid" : r.order_status === "cancelled" ? "Cancelled" : "Owed"}
                </span>
                {r.escrowed ? (
                  <span className="flex items-center gap-1 text-[10px] text-muted">
                    <ShieldCheck className="h-3 w-3 text-success" /> escrowed
                  </span>
                ) : (
                  <span className="text-[10px] text-dim">no escrow</span>
                )}
                <span className="ml-auto text-[10px] text-dim">
                  {new Date(r.created_at).toLocaleDateString("en-UG")}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-bg p-2.5 text-center">
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-dim">Business</p>
                  <p className="text-[13px] font-bold tabular-nums text-go">
                    {formatUgx(r.amounts.merchant_payout_ugx)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-dim">Rider</p>
                  <p className="text-[13px] font-bold tabular-nums text-primary">
                    {formatUgx(r.amounts.rider_payout_ugx)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-dim">Platform</p>
                  <p className="text-[13px] font-bold tabular-nums text-success">
                    {formatUgx(r.amounts.platform_fees_ugx)}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 space-y-1">
                <PartyRow role="biz" party={r.parties.business} />
                <PartyRow role="rider" party={r.parties.rider} />
                <PartyRow role="cust" party={r.parties.customer} />
              </div>

              {r.order_status === "cancelled" && (
                <p className="mt-2 rounded-lg bg-elevated px-2 py-1.5 text-[10px] text-muted">
                  {r.refundable_to_wallet
                    ? "Escrow was held — refund the customer to their GoDoor wallet."
                    : "No escrow was held, so nothing to refund in-app. Refund over Morse."}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
