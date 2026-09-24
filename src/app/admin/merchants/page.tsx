"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Store, Search, CheckCircle2, Ban, ShieldCheck, MapPin,
  Star, Clock, Phone, Mail, ArrowLeft, BadgeCheck, X, ChevronDown
} from "lucide-react";
import { fetchMerchants, approveMerchant, suspendMerchant, verifyMerchant, type DBMerchant } from "@/lib/db";
import { formatUgx } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success/15 text-success",
  pending: "bg-warning/15 text-warning",
  suspended: "bg-danger/15 text-danger",
};

export default function AdminMerchants() {
  const [merchants, setMerchants] = useState<DBMerchant[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedMerchant, setSelectedMerchant] = useState<DBMerchant | null>(null);

  const refresh = () =>
    fetch("/api/admin/businesses", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (Array.isArray(d.businesses)) setMerchants(d.businesses as any); else return fetchMerchants().then(setMerchants); })
      .catch(() => fetchMerchants().then(setMerchants));
  useEffect(() => { refresh(); }, []);

  const apiAction = async (id: string, action: string, verified?: boolean) => {
    try {
      const res = await fetch("/api/admin/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, verified }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) { await refresh(); return; }
      throw new Error(d.error || "failed");
    } catch {
      if (action === "approve") await approveMerchant(id);
      else if (action === "suspend") await suspendMerchant(id);
      if (verified !== undefined) await verifyMerchant(id, verified);
      await refresh();
    }
  };

  const filtered = merchants.filter((m) => {
    if (filter !== "all" && m.status !== filter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return m.name.toLowerCase().includes(s) || m.category.toLowerCase().includes(s) || m.area.toLowerCase().includes(s);
  });

  const counts = {
    all: merchants.length,
    active: merchants.filter((m) => m.status === "active").length,
    pending: merchants.filter((m) => m.status === "pending").length,
    suspended: merchants.filter((m) => m.status === "suspended").length,
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold">Merchants</h1>
        <span className="rounded-full bg-go/15 px-2.5 py-0.5 text-xs font-bold text-go">{merchants.length}</span>
      </div>
      <p className="mt-1 text-sm text-muted">Manage businesses on GoDoor — approve, verify, or suspend.</p>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["all", "active", "pending", "suspended"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === f ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchants…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go focus:ring-2" />
      </div>

      {/* Merchant list */}
      <div className="mt-4 space-y-2">
        {filtered.map((m) => (
          <div key={m.id} className="rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-go/10 ring-1 ring-go/20">
                <Store className="h-5 w-5 text-go" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{m.name}</h3>
                  {(m as any).verified && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      <BadgeCheck className="h-2.5 w-2.5" /> Verified
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">{m.category} · {m.tagline}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-dim">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{m.area}</span>
                  <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 text-warning" />{m.rating}</span>
                  <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{m.momo_number}</span>
                  <span>Delivery: {formatUgx(m.delivery_fee_ugx)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLORS[m.status] || "bg-elevated text-muted"}`}>
                  {m.status}
                </span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {m.status === "pending" && (
                <button type="button" onClick={() => apiAction(m.id, "approve")}
                  className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25 transition">
                  <CheckCircle2 className="h-3 w-3" /> Approve
                </button>
              )}
              {m.status === "active" && (
                <button type="button" onClick={() => apiAction(m.id, "suspend")}
                  className="flex items-center gap-1.5 rounded-xl bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/25 transition">
                  <Ban className="h-3 w-3" /> Suspend
                </button>
              )}
              {m.status === "suspended" && (
                <button type="button" onClick={() => apiAction(m.id, "approve")}
                  className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25 transition">
                  <CheckCircle2 className="h-3 w-3" /> Reactivate
                </button>
              )}
              <button type="button" onClick={() => apiAction(m.id, "verify", !(m as any).verified)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  (m as any).verified
                    ? "bg-elevated text-muted hover:bg-panel"
                    : "bg-primary/15 text-primary hover:bg-primary/25"
                }`}>
                <BadgeCheck className="h-3 w-3" /> {(m as any).verified ? "Remove badge" : "Verify"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <Store className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No merchants found</p>
          </div>
        )}
      </div>
    </div>
  );
}
