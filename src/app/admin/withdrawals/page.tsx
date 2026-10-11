"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight, CheckCircle2, XCircle, Loader2, ShieldCheck, AtSign, Ban,
} from "lucide-react";
import { withdrawalDestination } from "@/lib/withdrawal";

/**
 * Admin withdrawal queue and fee controls.
 *
 * GoDoor pays out by hand over Morse, exactly as top-ups are reconciled
 * manually, so this screen is the operational surface: see what was requested,
 * send the money to that user's Morse handle, then mark it paid. Marking paid is
 * what tells the customer their money left; cancelling returns it to their
 * wallet and writes the compensating ledger row.
 *
 * The fee controls live here rather than in code because a withdrawal fee is a
 * commercial decision that should not need a deploy to change.
 */

type Rec = {
  id: string;
  email: string;
  role: "customer" | "rider" | "business";
  gross: number;
  fee: number;
  feePercent: number;
  net: number;
  morseTag?: string;
  msisdn?: string;
  status: "pending" | "paid" | "cancelled";
  reference: string;
  note: string;
  requestedAt: string;
  adminNote: string;
};

type Config = {
  enabled: boolean;
  customer_fee_percent: number;
  rider_fee_percent: number;
  business_fee_percent: number;
  min_amount_ugx: number;
  max_amount_ugx: number;
  daily_limit_ugx: number;
  require_pin: boolean;
};

const fmt = (n: unknown) => `UGX ${Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US")}`;

const FIELDS: { key: keyof Config; label: string; help: string; step?: string }[] = [
  { key: "customer_fee_percent", label: "Customer fee (%)", help: "Charged on a customer's own balance", step: "0.1" },
  { key: "rider_fee_percent", label: "Rider fee (%)", help: "They earned it — keep at 0", step: "0.1" },
  { key: "business_fee_percent", label: "Business fee (%)", help: "Charged on a shop's own balance", step: "0.1" },
  { key: "min_amount_ugx", label: "Minimum (UGX)", help: "Rejects tiny payouts and their fees" },
  { key: "max_amount_ugx", label: "Maximum (UGX)", help: "Per single request" },
  { key: "daily_limit_ugx", label: "Daily limit (UGX)", help: "0 = no limit" },
];

export default function AdminWithdrawalsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [pending, setPending] = useState<Rec[]>([]);
  const [history, setHistory] = useState<Rec[]>([]);
  const [totals, setTotals] = useState({ pendingNet: 0, pendingFees: 0, paidNet: 0, earnedFees: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/withdrawals", { cache: "no-store" });
      if (!res.ok) return;
      const b = await res.json();
      setConfig(b.config);
      setPending(b.pending ?? []);
      setHistory(b.history ?? []);
      setTotals(b.totals ?? { pendingNet: 0, pendingFees: 0, paidNet: 0, earnedFees: 0 });
    } catch {
      setError("Could not load withdrawals.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (patch: Partial<Config>) => {
      setSaving(true);
      setError("");
      try {
        const res = await fetch("/api/admin/withdrawals", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) {
          setError(b?.error || "Could not save those settings.");
          return;
        }
        setConfig(b.config);
      } catch {
        setError("Network problem. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const decide = useCallback(
    async (id: string, action: "paid" | "cancelled") => {
      setBusy(id);
      setError("");
      try {
        const res = await fetch("/api/admin/withdrawals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) {
          setError(b?.error || "Could not update that withdrawal.");
          return;
        }
        await load();
      } catch {
        setError("Network problem. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <ArrowUpRight className="h-5 w-5 text-go" />
          Withdrawals
        </h1>
        <p className="mt-1 text-sm text-muted">
          Send the money on the payout number, then mark it paid. Cancelling returns the
          full amount to the customer&apos;s wallet.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Totals */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting payout" value={fmt(totals.pendingNet)} tone="text-go" />
        <Stat label="Fees on those" value={fmt(totals.pendingFees)} tone="text-success" />
        <Stat label="Paid out" value={fmt(totals.paidNet)} />
        <Stat label="Fees earned" value={fmt(totals.earnedFees)} tone="text-success" />
      </div>

      {/* Controls */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <ShieldCheck className="h-4 w-4 text-go" />
          Fee &amp; limit controls
        </h2>

        {config && (
          <div className="mt-4 flex flex-wrap gap-4">
            <Toggle
              label="Withdrawals open"
              hint="Off hides the button for everyone and refuses every request"
              on={config.enabled}
              onChange={(v) => void save({ enabled: v })}
            />
            <Toggle
              label="Require PIN / fingerprint"
              hint="Only applies to wallets that have enrolled"
              on={config.require_pin}
              onChange={(v) => void save({ require_pin: v })}
            />
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <label key={String(f.key)} className="block text-xs font-semibold text-muted">
              {f.label}
              <input
                type="number"
                step={f.step ?? "1"}
                value={config ? String(config[f.key] as number) : ""}
                onChange={(e) =>
                  setConfig((c) => (c ? { ...c, [f.key]: Number(e.target.value) } : c))
                }
                onBlur={(e) => void save({ [f.key]: Number(e.target.value) } as Partial<Config>)}
                className="num mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go"
              />
              <span className="mt-1 block text-[10px] font-normal text-dim">{f.help}</span>
            </label>
          ))}
        </div>

        {saving && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}
      </section>

      {/* Queue */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-display text-base font-semibold">Awaiting payout ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing waiting. </p>
        ) : (
          <div className="mt-4 space-y-3">
            {pending.map((w) => (
              <div key={w.id} className="rounded-xl border border-border bg-bg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-display text-lg font-bold">{fmt(w.net)}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <AtSign className="h-3 w-3" />
                      <span className="font-mono font-semibold text-fg">
                        {withdrawalDestination(w)}
                      </span>
                      <span className="font-mono text-[10px]">{w.reference}</span>
                    </p>
                    <p className="mt-1 truncate text-[11px] text-dim">
                      {w.email} · {w.role}
                      {w.fee > 0
                        ? ` · gross ${fmt(w.gross)} − fee ${fmt(w.fee)} (${w.feePercent}%)`
                        : " · no fee"}
                    </p>
                    {w.note && <p className="mt-1 text-[11px] italic text-muted">“{w.note}”</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy === w.id}
                      onClick={() => void decide(w.id, "paid")}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-success px-3 py-2 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50"
                    >
                      {busy === w.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Mark paid
                    </button>
                    <button
                      type="button"
                      disabled={busy === w.id}
                      onClick={() => void decide(w.id, "cancelled")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-elevated px-3 py-2 text-xs font-bold text-muted transition active:scale-95 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-display text-base font-semibold">History ({history.length})</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No completed withdrawals yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {history.slice(0, 40).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <span className="num font-semibold text-fg">{fmt(w.net)}</span>
                <span className="num text-muted">{withdrawalDestination(w)}</span>
                <span className="truncate text-dim">{w.email}</span>
                <span
                  className={`shrink-0 font-semibold ${w.status === "paid" ? "text-success" : "text-muted"}`}
                >
                  {w.status === "paid" ? "Paid" : "Cancelled"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-dim">{label}</p>
      <p className={`num mt-1 font-display text-lg font-bold ${tone ?? "text-fg"}`}>{value}</p>
    </div>
  );
}

function Toggle({
  label, hint, on, onChange,
}: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-start gap-2 text-left"
    >
      <span
        className={`mt-0.5 grid h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition ${on ? "bg-go" : "bg-border"}`}
      >
        <span className={`h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-xs font-bold text-fg">{label}</span>
        <span className="block text-[10px] text-dim">{hint}</span>
      </span>
    </button>
  );
}

export { Ban };
