"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, Undo2, Loader2, ShieldCheck, Search, Inbox, Ban,
} from "lucide-react";

/**
 * Admin transfer ledger and controls.
 *
 * A P2P transfer settles the instant it is sent, so there is nothing here to
 * approve — this is an audit surface instead. Every movement between two GoDoor
 * accounts is listed newest-first with both parties, the reference that ties it
 * to the two ledger rows, and a search across name, email and reference.
 *
 * The single write action is a reversal, for money sent to the wrong person. It
 * writes its own compensating ledger pair, so a reversed transfer stays visible
 * and auditable rather than disappearing.
 */

type Rec = {
  id: string;
  reference: string;
  fromUserId: string;
  fromEmail: string;
  fromName: string;
  toUserId: string;
  toEmail: string;
  toName: string;
  amount: number;
  fee: number;
  feePercent: number;
  net: number;
  note: string;
  status: "completed" | "reversed";
  reversalReason: string;
  createdAt: string;
};

type Config = {
  enabled: boolean;
  fee_percent: number;
  min_amount_ugx: number;
  max_amount_ugx: number;
  daily_limit_ugx: number;
  require_pin: boolean;
  show_recipient_name: boolean;
};

const fmt = (n: unknown) => `UGX ${Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US")}`;

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

const who = (name: string, email: string) => name || email || "unknown";

const FIELDS: { key: keyof Config; label: string; help: string; step?: string }[] = [
  { key: "fee_percent", label: "Transfer fee (%)", help: "Kept by GoDoor — free at 0", step: "0.1" },
  { key: "min_amount_ugx", label: "Minimum (UGX)", help: "Rejects dust transfers" },
  { key: "max_amount_ugx", label: "Maximum (UGX)", help: "Per single send" },
  { key: "daily_limit_ugx", label: "Daily limit (UGX)", help: "Across all sends by one user. 0 = no limit" },
];

export default function AdminTransfersPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [all, setAll] = useState<Rec[]>([]);
  const [totals, setTotals] = useState({ count: 0, volume: 0, fees: 0, todayVolume: 0, reversed: 0 });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/transfers", { cache: "no-store" });
      if (!res.ok) return;
      const b = await res.json();
      setConfig(b.config);
      setAll(b.transfers ?? []);
      setTotals(b.totals ?? { count: 0, volume: 0, fees: 0, todayVolume: 0, reversed: 0 });
    } catch {
      setError("Could not load transfers.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (patch: Partial<Config>) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/transfers", {
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
  }, []);

  const reverse = useCallback(async (rec: Rec) => {
    const reason = window.prompt(
      `Reverse ${fmt(rec.net)} from ${who(rec.fromName, rec.fromEmail)} to ${who(rec.toName, rec.toEmail)}?\n\nThe money returns to the sender and both wallets get a compensating ledger entry. Give a reason:`,
    );
    if (!reason || reason.trim().length < 4) return;
    setBusy(rec.id);
    setError("");
    try {
      const res = await fetch("/api/admin/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rec.id, reason: reason.trim() }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) {
        setError(b?.error || "Could not reverse that transfer.");
        return;
      }
      await load();
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setBusy(null);
    }
  }, [load]);

  /* Filtering runs over the whole list on every keystroke, so it stays a plain
     memo rather than debounced state — the list is capped by the API and this
     keeps typing responsive without a second source of truth. */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((t) =>
      [t.fromEmail, t.toEmail, t.fromName, t.toName, t.reference, t.note]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [all, q]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <ArrowLeftRight className="h-5 w-5 text-go" />
          Transfers
        </h1>
        <p className="mt-1 text-sm text-muted">
          Every payment sent between two GoDoor accounts. Both ledger rows share
          the reference shown, so a disputed transfer reconciles from either side.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Transfers" value={String(totals.count)} />
        <Stat label="Volume (net)" value={fmt(totals.volume)} tone="text-go" />
        <Stat label="Fees earned" value={fmt(totals.fees)} tone="text-success" />
        <Stat label="Today" value={fmt(totals.todayVolume)} />
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <ShieldCheck className="h-4 w-4 text-go" />
          Fee &amp; limit controls
        </h2>

        {config && (
          <div className="mt-4 flex flex-wrap gap-4">
            <Toggle
              label="Transfers open"
              hint="Off hides the button for everyone and refuses every send"
              on={config.enabled}
              onChange={(v) => void save({ enabled: v })}
            />
            <Toggle
              label="Require PIN / fingerprint"
              hint="Only applies to wallets that have enrolled"
              on={config.require_pin}
              onChange={(v) => void save({ require_pin: v })}
            />
            <Toggle
              label="Show recipient name"
              hint="Recipient sees who sent them money"
              on={config.show_recipient_name}
              onChange={(v) => void save({ show_recipient_name: v })}
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

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">
            Ledger ({filtered.length}
            {filtered.length !== all.length ? ` of ${all.length}` : ""})
          </h2>
          <label className="relative block">
            <span className="sr-only">Search transfers</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email or reference"
              className="w-full rounded-xl border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-go sm:w-72"
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center">
            <Inbox className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-3 font-display text-sm font-semibold text-fg">
              {all.length === 0 ? "No transfers yet" : "No transfers match that search"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {all.length === 0
                ? "When a customer sends money to another GoDoor account, it appears here instantly."
                : "Try a different name, email or reference."}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {filtered.slice(0, 60).map((t) => (
              <div
                key={t.id}
                className={`rounded-xl border bg-bg p-4 ${
                  t.status === "reversed" ? "border-border opacity-70" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-display text-lg font-bold">{fmt(t.net)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      <span className="font-semibold text-fg">{who(t.fromName, t.fromEmail)}</span>
                      <ArrowLeftRight className="mx-1.5 inline h-3 w-3 text-dim" />
                      <span className="font-semibold text-fg">{who(t.toName, t.toEmail)}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-dim">
                      <span className="font-mono">{t.reference}</span>
                      <span>·</span>
                      <span>{when(t.createdAt)}</span>
                      {t.fee > 0 && (
                        <>
                          <span>·</span>
                          <span className="num">
                            gross {fmt(t.amount)} − fee {fmt(t.fee)} ({t.feePercent}%)
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-dim">
                      {t.fromEmail} → {t.toEmail}
                    </p>
                    {t.note && <p className="mt-1 text-[11px] italic text-muted">“{t.note}”</p>}
                    {t.status === "reversed" && (
                      <p className="mt-1 text-[11px] font-semibold text-danger">
                        Reversed{t.reversalReason ? ` — ${t.reversalReason}` : ""}
                      </p>
                    )}
                  </div>

                  {t.status === "completed" && (
                    <button
                      type="button"
                      disabled={busy === t.id}
                      onClick={() => void reverse(t)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-elevated px-3 py-2 text-xs font-bold text-muted transition active:scale-95 disabled:opacity-50"
                    >
                      {busy === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Undo2 className="h-3.5 w-3.5" />
                      )}
                      Reverse
                    </button>
                  )}
                </div>
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