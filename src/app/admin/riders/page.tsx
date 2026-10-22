"use client";

import { useState, useEffect } from "react";
import {
  Truck, Search, BadgeCheck, Ban, CheckCircle2, MapPin, Star, Clock, Phone, KeyRound, X, Copy, Check
} from "lucide-react";
import { fetchRiders, verifyRider, updateRiderStatus, type DBRider } from "@/lib/db";

const STATUS_COLORS: Record<string, string> = {
  online: "bg-success/15 text-success",
  offline: "bg-elevated text-muted",
  suspended: "bg-danger/15 text-danger",
  busy: "bg-go/15 text-go",
};

export default function AdminRiders() {
  const [riders, setRiders] = useState<DBRider[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [pwModal, setPwModal] = useState<{ name: string; email: string; password: string; link: string } | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () =>
    fetch("/api/admin/riders", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (Array.isArray(d.riders)) setRiders(d.riders as any); else return fetchRiders().then(setRiders); })
      .catch(() => fetchRiders().then(setRiders));
  useEffect(() => { refresh(); }, []);
  const apiAction = async (id: string, action: string, verified?: boolean) => {
    try {
      const res = await fetch("/api/admin/riders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, verified }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) { await refresh(); return; }
      throw new Error(d.error || "failed");
    } catch {
      if (action === "suspend") await updateRiderStatus(id, "suspended");
      else if (action === "activate") await updateRiderStatus(id, "online");
      if (verified !== undefined) await verifyRider(id, verified);
      await refresh();
    }
  };

  /**
   * Issue a one-time reset code for a rider who cannot sign in.
   *
   * The rider's password is NOT changed here. They get a link plus a code,
   * and choose their own password at /reset-password. The rider's account
   * keeps working normally until they do.
   */
  const resetPassword = async (r: DBRider) => {
    setResetting(r.id);
    try {
      const res = await fetch("/api/admin/riders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, action: "issue_reset_code" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok && d?.code) {
        setCopied(false);
        setPwModal({
          name: r.name,
          email: d.email || r.email || "",
          password: d.code,
          link: `${typeof window !== "undefined" ? window.location.origin : ""}/reset-password?token=${d.id}`,
        });
      } else {
        alert(d.error || "Could not issue a reset code");
      }
    } catch {
      alert("Could not reach the server");
    }
    setResetting(null);
  };

  const filtered = riders.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return r.name.toLowerCase().includes(s) || r.vehicle_type.toLowerCase().includes(s) || r.service_area.toLowerCase().includes(s) || (r.phone && r.phone.toLowerCase().includes(s));
  });

  const counts = {
    all: riders.length,
    online: riders.filter((r) => r.status === "online").length,
    offline: riders.filter((r) => r.status === "offline").length,
    suspended: riders.filter((r) => r.status === "suspended").length,
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold">Riders</h1>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary">{riders.length}</span>
      </div>
      <p className="mt-1 text-sm text-muted">Manage delivery riders — verify, suspend, or view activity.</p>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["all", "online", "offline", "suspended"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === f ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search riders…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go focus:ring-2" />
      </div>

      <div className="mt-4 space-y-2">
        {filtered.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/30">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Truck className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{r.name}</h3>
                  {r.verified && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      <BadgeCheck className="h-2.5 w-2.5" /> Verified
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">{r.vehicle_type} · {r.plate}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-dim">
                  {r.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{r.service_area}</span>
                  <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 text-warning" />{r.rating}</span>
                  <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" />{r.total_deliveries} deliveries</span>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLORS[r.status] || "bg-elevated text-muted"}`}>
                {r.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <button type="button" onClick={() => apiAction(r.id, "verify", !r.verified)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  r.verified ? "bg-elevated text-muted hover:bg-panel" : "bg-primary/15 text-primary hover:bg-primary/25"
                }`}>
                <BadgeCheck className="h-3 w-3" /> {r.verified ? "Remove badge" : "Verify"}
              </button>
              {r.status !== "suspended" ? (
                <button type="button" onClick={() => apiAction(r.id, "suspend")}
                  className="flex items-center gap-1.5 rounded-xl bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/25 transition">
                  <Ban className="h-3 w-3" /> Suspend
                </button>
              ) : (
                <button type="button" onClick={() => apiAction(r.id, "activate")}
                  className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25 transition">
                  <CheckCircle2 className="h-3 w-3" /> Reactivate
                </button>
              )}
              <button type="button" disabled={resetting === r.id || !r.email}
                onClick={() => resetPassword(r)}
                className="flex items-center gap-1.5 rounded-xl bg-warning/15 px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-warning/25 transition disabled:opacity-40"
                title="Send them a one-time code to choose their own password" >
                <KeyRound className="h-3 w-3" /> {resetting === r.id ? "Issuing…" : "Reset password"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <Truck className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No riders found</p>
            <p className="mt-1 text-xs text-dim">Riders appear here after completing onboarding. If a rider is missing, issue them a reset code and ask them to sign in once.</p>
          </div>
        )}
      </div>

      {/* One-time reset code — shown exactly once after issuing */}
      {pwModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={() => setPwModal(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-amber-500" />
                <h3 className="font-display text-sm font-bold">Reset code for {pwModal.name}</h3>
              </div>
              <button type="button" onClick={() => setPwModal(null)} className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 space-y-2 rounded-xl bg-bg p-3 text-xs">
              <p className="text-muted">Email: <span className="font-semibold text-fg">{pwModal.email}</span></p>
              <p className="text-muted">One-time code: <span className="font-mono font-bold tracking-wider text-fg">{pwModal.password}</span></p>
              <p className="break-all text-muted">Reset link: <span className="text-fg">{pwModal.link}</span></p>
            </div>
            <button type="button" onClick={() => {
              navigator.clipboard.writeText(
                `GoDoor — Reset your password\n\nHi ${pwModal.name},\n\n` +
                `Link to reset your password: ${pwModal.link}\n` +
                `One-time code: ${pwModal.password}\n\n` +
                `This code expires in 24 hours and can only be used once.`
              ).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-2.5 text-xs font-semibold text-white hover:bg-go-2 transition">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy & send to rider"}
            </button>
            <p className="mt-2 text-center text-[10px] text-dim">Valid for 24 hours, one time only. Their password is unchanged until they use it.</p>
          </div>
        </div>
      )}
    </div>
  );
}
