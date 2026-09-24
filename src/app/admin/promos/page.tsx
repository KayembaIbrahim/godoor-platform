"use client";
import { useState } from "react";
import Link from "next/link";
import { Tag, Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check } from "lucide-react";

type Promo = {
  id: string;
  code: string;
  type: "percent" | "flat";
  value: number;
  minOrder: number;
  maxUses: number;
  uses: number;
  active: boolean;
  expiresAt: string;
};

const INITIAL_PROMOS: Promo[] = [
  { id: "1", code: "GODOOR10", type: "percent", value: 10, minOrder: 10000, maxUses: 1000, uses: 45, active: true, expiresAt: "2026-12-31" },
  { id: "2", code: "WELCOME", type: "flat", value: 5000, minOrder: 15000, maxUses: 500, uses: 120, active: true, expiresAt: "2026-12-31" },
  { id: "3", code: "FIRSTORDER", type: "percent", value: 15, minOrder: 5000, maxUses: 2000, uses: 300, active: true, expiresAt: "2026-12-31" },
  { id: "4", code: "FREEDEL", type: "flat", value: 2000, minOrder: 8000, maxUses: 500, uses: 80, active: false, expiresAt: "2026-06-30" },
];

export default function AdminPromosPage() {
  const [promos, setPromos] = useState<Promo[]>(INITIAL_PROMOS);
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "flat">("percent");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("5000");
  const [maxUses, setMaxUses] = useState("1000");
  const [expiresAt, setExpiresAt] = useState("2026-12-31");
  const [copied, setCopied] = useState<string | null>(null);

  const addPromo = () => {
    if (!code.trim() || !value) return;
    setPromos([...promos, {
      id: Date.now().toString(36), code: code.toUpperCase(), type, value: Number(value),
      minOrder: Number(minOrder), maxUses: Number(maxUses), uses: 0, active: true, expiresAt,
    }]);
    setCode(""); setValue(""); setShowAdd(false);
  };

  const togglePromo = (id: string) => {
    setPromos(promos.map((p) => p.id === id ? { ...p, active: !p.active } : p));
  };

  const deletePromo = (id: string) => {
    setPromos(promos.filter((p) => p.id !== id));
  };

  const copyCode = (c: string) => {
    navigator.clipboard.writeText(c);
    setCopied(c);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Promo Codes</h1>
          <p className="mt-1 text-sm text-muted">Create and manage discount codes for customers.</p>
        </div>
        <button type="button" onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 rounded-xl bg-go px-3 py-2 text-xs font-semibold text-white hover:bg-go-2 transition">
          <Plus className="h-3.5 w-3.5" /> New promo
        </button>
      </div>

      {showAdd && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4 animate-slide-up">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] text-dim uppercase tracking-wider">Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER20"
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-bold outline-none ring-go focus:ring-2" /></div>
            <div><label className="text-[10px] text-dim uppercase tracking-wider">Type</label>
              <div className="mt-1 flex gap-1.5">
                <button type="button" onClick={() => setType("percent")} className={`flex-1 rounded-xl py-2.5 text-xs font-medium transition ${type === "percent" ? "bg-go text-white" : "bg-bg text-muted"}`}>% Discount</button>
                <button type="button" onClick={() => setType("flat")} className={`flex-1 rounded-xl py-2.5 text-xs font-medium transition ${type === "flat" ? "bg-go text-white" : "bg-bg text-muted"}`}>Flat UGX</button>
              </div>
            </div>
            <div><label className="text-[10px] text-dim uppercase tracking-wider">{type === "percent" ? "Discount %" : "Discount UGX"}</label>
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percent" ? "10" : "5000"}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" /></div>
            <div><label className="text-[10px] text-dim uppercase tracking-wider">Min order (UGX)</label>
              <input type="number" value={minOrder} onChange={(e) => setMinOrder(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" /></div>
            <div><label className="text-[10px] text-dim uppercase tracking-wider">Max uses</label>
              <input type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" /></div>
            <div><label className="text-[10px] text-dim uppercase tracking-wider">Expires</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" /></div>
          </div>
          <button type="button" onClick={addPromo} disabled={!code.trim() || !value}
            className="mt-3 w-full rounded-xl bg-go py-2.5 text-xs font-semibold text-white hover:bg-go-2 disabled:opacity-40 transition">
            Create promo
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {promos.map((p) => (
          <div key={p.id} className={`rounded-2xl border bg-surface p-4 transition ${p.active ? "border-border" : "border-border opacity-50"}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-bold text-go">{p.code}</span>
                  <button type="button" onClick={() => copyCode(p.code)} title="Copy code"
                    className="grid h-7 w-7 place-items-center rounded-lg border border-border text-dim transition hover:border-go/40 hover:text-go active:scale-95">
                    {copied === p.code ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {p.type === "percent" ? `${p.value}% off` : `UGX ${p.value.toLocaleString()} off`} · Min order UGX {p.minOrder.toLocaleString()}
                </p>
                <p className="text-[10px] text-dim mt-1">Used {p.uses}/{p.maxUses} · Expires {p.expiresAt}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${p.active ? "bg-success/15 text-success" : "bg-elevated text-muted"}`}>
                {p.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="mt-3 flex gap-2 border-t border-border pt-3">
              <button type="button" onClick={() => togglePromo(p.id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition ${p.active ? "bg-warning/15 text-warning hover:bg-warning/25" : "bg-success/15 text-success hover:bg-success/25"}`}>
                {p.active ? <ToggleLeft className="h-3 w-3" /> : <ToggleRight className="h-3 w-3" />}
                {p.active ? "Deactivate" : "Activate"}
              </button>
              <button type="button" onClick={() => deletePromo(p.id)}
                className="flex items-center gap-1 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[10px] font-medium text-danger hover:bg-danger/20 transition">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
