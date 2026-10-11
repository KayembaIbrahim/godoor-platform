"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Copy, Check, RotateCcw, Star, Loader2, AlertTriangle } from "lucide-react";
import type { Promo } from "@/lib/promo";

/**
 * Promo codes — real, persisted admin control.
 *
 * This page used to be `useState(INITIAL_PROMOS)`: creating, toggling and
 * deleting a promo mutated React state and nothing else. Refreshing the browser
 * threw it away, and no code an admin touched ever reached a customer's
 * checkout. It looked like a working control panel and was not one.
 *
 * Every write here goes to `/api/admin/promos`, which validates the whole table
 * server-side before replacing it, and `/api/orders` resolves against the same
 * store — so what this page shows is what a customer is actually charged.
 */

type Entry = Promo & {
  id: string;
  code: string;
  discount: number;
  type: "percent" | "flat";
  label: string;
  minSubtotalUgx: number;
  expiresAt: string | null;
  active: boolean;
  maxUses: number;
  uses: number;
  featured: boolean;
};

const BLANK = {
  code: "",
  /* Widened to the domain type, not `as const`. `as const` pinned this to the
     literal "percent", so the "% off / Flat UGX" toggle below could not select
     "flat" without a type error — and a flat credit is a real option an admin
     needs (`FREEDEL` ships as one). */
  type: "percent" as Promo["type"],
  discount: 20,
  minSubtotalUgx: 5000,
  maxUses: 0,
  expiresAt: "",
  label: "",
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function AdminPromosPage() {
  const [promos, setPromos] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/promos", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Session expired — sign in again" : `Could not load (${res.status})`);
      const json = (await res.json()) as { effective?: Record<string, Entry> };
      const table = json.effective ?? {};
      setPromos(
        Object.values(table)
          .map((p) => ({
            ...p,
            id: p.id ?? `pm_${p.code.toLowerCase()}`,
            maxUses: p.maxUses ?? 0,
            uses: p.uses ?? 0,
            featured: p.featured === true,
          }))
          .sort((a, b) => Number(b.featured) - Number(a.featured) || a.code.localeCompare(b.code)),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load promo codes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (next: Entry[]) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promos: next }),
      });
      const json = (await res.json()) as { error?: string; promos?: Entry[] };
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      setPromos(json.promos ?? next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      /* Re-read from the server: the previous list is still live, and showing a
         change that was rejected would be a lie. */
      setError(e instanceof Error ? e.message : "Save failed");
      void load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  const patch = (code: string, next: Partial<Entry>) =>
    void persist(promos.map((p) => (p.code === code ? { ...p, ...next } : p)));

  const remove = (code: string) => void persist(promos.filter((p) => p.code !== code));

  const add = () => {
    const code = draft.code.trim().toUpperCase();
    if (!code) return;
    if (promos.some((p) => p.code === code)) {
      setError(`${code} already exists`);
      return;
    }
    void persist([
      ...promos,
      {
        id: `pm_${code.toLowerCase()}`,
        code,
        label: draft.label.trim() || undefined,
        discount: num(String(draft.discount)),
        type: draft.type,
        minSubtotalUgx: num(String(draft.minSubtotalUgx)),
        expiresAt: draft.expiresAt || null,
        active: true,
        maxUses: num(String(draft.maxUses)),
        uses: 0,
        featured: false,
      } as Entry,
    ]);
    setDraft(BLANK);
    setShowAdd(false);
  };

  const reset = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/promos", { method: "DELETE" });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  const copy = (c: string) => {
    void navigator.clipboard?.writeText(c);
    setCopied(c);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading promo codes…
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Promo Codes</h1>
          <p className="mt-1 text-sm text-muted">
            These are the codes customers redeem, and the discounts charged at checkout.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            title="Restore the shipped defaults"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border text-dim transition hover:border-go/40 hover:text-go disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-go px-3 py-2 text-xs font-semibold text-white transition hover:bg-go-2"
          >
            <Plus className="h-3.5 w-3.5" /> New promo
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        {saving ? (
          <span className="flex items-center gap-1.5 text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
        ) : saved ? (
          <span className="flex items-center gap-1.5 text-success"><Check className="h-3 w-3" /> Saved — live now</span>
        ) : null}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </p>
      )}

      {showAdd && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4 animate-slide-up">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-dim">Code</label>
              <input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="MASAKA20"
                maxLength={20}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-bold outline-none ring-go focus:ring-2"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-dim">Type</label>
              <div className="mt-1 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, type: "percent" })}
                  className={`flex-1 rounded-xl py-2.5 text-xs font-medium transition ${draft.type === "percent" ? "bg-go text-white" : "bg-bg text-muted"}`}
                >
                  % off
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, type: "flat" })}
                  className={`flex-1 rounded-xl py-2.5 text-xs font-medium transition ${draft.type === "flat" ? "bg-go text-white" : "bg-bg text-muted"}`}
                >
                  Flat UGX
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-dim">
                {draft.type === "percent" ? "Discount %" : "Discount UGX"}
              </label>
              <input
                type="number"
                min={1}
                max={draft.type === "percent" ? 90 : 500000}
                value={draft.discount}
                onChange={(e) => setDraft({ ...draft, discount: num(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-dim">Min order (UGX)</label>
              <input
                type="number"
                min={0}
                value={draft.minSubtotalUgx}
                onChange={(e) => setDraft({ ...draft, minSubtotalUgx: num(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-dim">Max uses (0 = unlimited)</label>
              <input
                type="number"
                min={0}
                value={draft.maxUses}
                onChange={(e) => setDraft({ ...draft, maxUses: num(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-dim">Expires (optional)</label>
              <input
                type="date"
                value={draft.expiresAt}
                onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!draft.code.trim() || num(String(draft.discount)) <= 0}
            className="mt-3 w-full rounded-xl bg-go py-2.5 text-xs font-semibold text-white transition hover:bg-go-2 disabled:opacity-40"
          >
            Create promo
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {promos.map((p) => (
          <div
            key={p.code}
            className={`rounded-2xl border bg-surface p-4 transition ${p.active ? "border-border" : "border-border opacity-60"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display text-lg font-bold text-go">{p.code}</span>
                  {p.featured && (
                    <span className="flex items-center gap-1 rounded-full bg-go/15 px-2 py-0.5 text-[9px] font-semibold text-go">
                      <Star className="h-2.5 w-2.5" /> On the home banner
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => copy(p.code)}
                    title="Copy code"
                    className="grid h-6 w-6 place-items-center rounded-lg border border-border text-dim transition hover:border-go/40 hover:text-go active:scale-95"
                  >
                    {copied === p.code ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-muted">{p.label}</p>
                <p className="mt-1 text-[10px] text-dim">
                  {p.type === "percent" ? `${p.discount}% off` : `UGX ${p.discount.toLocaleString()} off`}
                  {p.minSubtotalUgx > 0 && ` · Min order UGX ${p.minSubtotalUgx.toLocaleString()}`}
                  {p.maxUses > 0 ? ` · Used ${p.uses}/${p.maxUses}` : p.uses > 0 ? ` · Used ${p.uses}` : ""}
                  {p.expiresAt && ` · Expires ${p.expiresAt}`}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${p.active ? "bg-success/15 text-success" : "bg-elevated text-muted"}`}>
                {p.active ? "Active" : "Off"}
              </span>
            </div>

            {/* Editable in place — the whole point is being able to retune the
                % without opening a form for each change. */}
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-dim">
                  {p.type === "percent" ? "Percent" : "UGX off"}
                </span>
                <input
                  type="number"
                  min={1}
                  max={p.type === "percent" ? 90 : 500000}
                  defaultValue={p.discount}
                  onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v > 0 && v !== p.discount) patch(p.code, { discount: v });
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm font-semibold outline-none ring-go focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-dim">Min order</span>
                <input
                  type="number"
                  min={0}
                  defaultValue={p.minSubtotalUgx}
                  onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v !== p.minSubtotalUgx) patch(p.code, { minSubtotalUgx: v });
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none ring-go focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="text-[9px] uppercase tracking-wider text-dim">Max uses</span>
                <input
                  type="number"
                  min={0}
                  defaultValue={p.maxUses}
                  onBlur={(e) => {
                    const v = num(e.target.value);
                    if (v !== p.maxUses) patch(p.code, { maxUses: v });
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none ring-go focus:ring-2"
                />
              </label>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => patch(p.code, { active: !p.active })}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${p.active ? "bg-warning/15 text-warning hover:bg-warning/25" : "bg-success/15 text-success hover:bg-success/25"}`}
              >
                {p.active ? "Turn off" : "Turn on"}
              </button>
              <button
                type="button"
                onClick={() => patch(p.code, { featured: !p.featured })}
                disabled={saving}
                title="The home banner advertises whichever code is starred"
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition disabled:opacity-40 ${p.featured ? "bg-go/15 text-go" : "bg-elevated text-muted hover:text-go"}`}
              >
                {p.featured ? "On banner" : "Feature on banner"}
              </button>
              <button
                type="button"
                onClick={() => remove(p.code)}
                className="ml-auto rounded-lg bg-danger/10 px-2.5 py-1.5 text-[10px] font-medium text-danger transition hover:bg-danger/20"
              >
                <Trash2 className="mr-1 inline h-3 w-3" /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {promos.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          No promo codes yet. Add one, or restore the defaults.
        </p>
      )}
    </div>
  );
}