"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, Truck, User, Mail, Phone, Clock, ClipboardCopy, Check, Loader2, MessageSquare, Key, AlertTriangle } from "lucide-react";
import * as Icons from "lucide-react";
import { useRouter } from "next/navigation";

type Request = {
  id: string;
  role: "business" | "rider";
  contact_name: string;
  email: string;
  phone: string;
  business_name: string;
  category: string;
  area: string;
  district: string;
  details: string;
  status: "new" | "contacted" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-warning/15 text-amber-600",
  contacted: "bg-primary/15 text-[#0284c7]",
  approved: "bg-success/15 text-success",
  rejected: "bg-danger/15 text-danger",
};

function relativeDate(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function summary(r: Request): string {
  const topic = r.role === "business"
    ? `${r.business_name} (${r.category || "—"}) wants to join GoDoor as a business`
    : `A rider from ${r.area || "—"} (${r.category || "—"}) wants to deliver for GoDoor`;
  return [
    `GoDoor Partner Application — ${r.role === "business" ? "Business" : "Rider"}`,
    topic,
    `Contact: ${r.contact_name}`,
    `Email: ${r.email || "—"}`,
    `Phone: ${r.phone || "—"}`,
    r.area ? `Area: ${r.area}` : "",
    r.details ? `Notes: ${r.details}` : "",
    `Recommendation: GoDoor team to decide (reviewer: admin)`,
  ].filter(Boolean).join("\n");
}

export default function AdminApplicationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "new" | "contacted" | "approved" | "rejected">("new");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // One-time rider credentials returned by Approve — shown exactly once.
  const [creds, setCreds] = useState<Record<string, { email: string; password: string }>>({});
  const [issueError, setIssueError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/partner-request", { cache: "no-store" });
    if (!res.ok && res.status === 401) { window.location.reload(); return; }
    const data = await res.json().catch(() => ({}));
    setItems(data.requests || []);
    setLoading(false);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    setBusyId(id);
    setIssueError(null);
    try {
      const res = await fetch("/api/partner-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, admin_note: notes[id] || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.credentials) {
        // One-time credentials for a freshly approved rider — show once.
        setCreds((prev) => ({ ...prev, [id]: data.credentials }));
      } else if (!res.ok && data?.error) {
        setIssueError(data.error);
      }
    } catch {
      setIssueError("Could not reach the server. Try again.");
    }
    await load();
    setBusyId(null);
  };

  const copy = async (r: Request) => {
    try {
      await navigator.clipboard.writeText(summary(r));
      setCopied(r.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  const copyCreds = async (r: Request) => {
    try {
      const c = creds[r.id];
      await navigator.clipboard.writeText(
        `GoDoor rider login for ${r.contact_name}\n\nEmail: ${c.email}\nOne-time password: ${c.password}\n\nSign in at godoor.site, then you will set your own password.`,
      );
      setCopied(r.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  const filtered = tab === "all" ? items : items.filter((r) => r.status === tab);
  const count = (s: string) => (s === "all" ? items.length : items.filter((r) => r.status === s).length);

  const TABS: { id: typeof tab; label: string }[] = [
    { id: "new", label: "New" },
    { id: "contacted", label: "Contacted" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
    { id: "all", label: "All" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold">Partnership Applications</h1>
          <p className="mt-0.5 text-xs text-muted">Businesses & riders applying to join GoDoor.</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-warning/15 px-3 py-1.5 text-xs font-semibold text-amber-600">
          <Clock className="h-3.5 w-3.5" /> {count("new")} new
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${tab === t.id ? "bg-go text-white" : "bg-elevated text-muted hover:bg-surface"}`}>
            {t.label} <span className="opacity-70">({count(t.id)})</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading applications…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
            <Icons.Inbox className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-3 text-sm font-medium text-muted">No applications here.</p>
            <p className="text-xs text-dim">New applications from the public land here automatically.</p>
          </div>
        )}

        {filtered.map((r) => {
          const isBusiness = r.role === "business";
          return (
            <div key={r.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isBusiness ? "bg-primary/10" : "bg-primary/10"}`}>
                    {isBusiness ? <Store className="h-5 w-5 text-primary" /> : <Truck className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-fg">{isBusiness ? r.business_name : r.contact_name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[r.status] || "bg-elevated text-muted"}`}>{r.status}</span>
                      <span className="text-[10px] text-dim">{relativeDate(r.created_at)}</span>
                    </div>
                    {isBusiness && r.contact_name && <p className="mt-0.5 text-xs text-muted">Contact: {r.contact_name}</p>}
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      {r.category && <span className="inline-flex items-center gap-1">{isBusiness ? <Store className="h-3 w-3" /> : <Truck className="h-3 w-3" />}{r.category}</span>}
                      {r.area && <span className="inline-flex items-center gap-1"><Icons.MapPin className="h-3 w-3" />{r.area}</span>}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{r.email || "—"}</span>
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone || "—"}</span>
                    </div>
                    {r.details && (
                      <p className="mt-1.5 rounded-lg bg-elevated/60 px-2.5 py-1.5 text-[11px] text-muted leading-relaxed">{r.details}</p>
                    )}
                    {r.admin_note && (
                      <p className="mt-1.5 flex items-start gap-1 text-[11px] text-dim">
                        <MessageSquare className="h-3 w-3 shrink-0 mt-0.5" />Note: {r.admin_note}
                      </p>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => copy(r)}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-elevated px-2.5 py-1.5 text-[10px] font-semibold text-muted transition hover:bg-panel">
                  {copied === r.id ? <Check className="h-3 w-3 text-success" /> : <ClipboardCopy className="h-3 w-3" />}
                  {copied === r.id ? "Copied" : "Share w/ marketing"}
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input value={notes[r.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  placeholder="Add a note…" className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-xs outline-none ring-go focus:ring-2" />
                <button type="button" disabled={busyId === r.id}
                  onClick={() => setStatus(r.id, "contacted")}
                  className="shrink-0 rounded-xl bg-primary/15 px-3 py-2 text-xs font-semibold text-[#0284c7] transition hover:bg-primary/25 disabled:opacity-50">
                  Contacted
                </button>
                <button type="button" disabled={busyId === r.id}
                  onClick={() => setStatus(r.id, "approved")}
                  className="shrink-0 rounded-xl bg-go/15 px-3 py-2 text-xs font-semibold text-go transition hover:bg-go/25 disabled:opacity-50">
                  {r.role === "rider" && !creds[r.id] ? "Approve + create login" : "Approve"}
                </button>
                <button type="button" disabled={busyId === r.id}
                  onClick={() => setStatus(r.id, "rejected")}
                  className="shrink-0 rounded-xl bg-danger/15 px-3 py-2 text-xs font-semibold text-danger transition hover:bg-danger/25 disabled:opacity-50">
                  Decline
                </button>
              </div>

              {/* Rider login credentials — one-time, shown only right after Approve */}
              {!isBusiness && creds[r.id] && (
                <div className="mt-3 rounded-2xl border border-success/30 bg-success/10 p-3.5">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-success" />
                    <p className="text-xs font-bold text-fg">Login ready — send these to {r.contact_name.split(" ")[0] || "the rider"}</p>
                  </div>
                  <div className="mt-2 space-y-1 rounded-xl bg-bg p-3 text-xs">
                    <p className="text-muted">Email: <span className="font-semibold text-fg">{creds[r.id].email}</span></p>
                    <p className="text-muted">One-time password: <span className="font-mono font-bold text-fg">{creds[r.id].password}</span></p>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button type="button" onClick={() => copyCreds(r)}
                      className="flex items-center gap-1.5 rounded-lg bg-go px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-go-2">
                      {copied === r.id ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                      {copied === r.id ? "Copied" : "Copy login details"}
                    </button>
                    <p className="text-[10px] text-dim flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> They must change it on first login. It is shown once.
                    </p>
                  </div>
                </div>
              )}

              {issueError && (
                <p className="mt-3 rounded-xl bg-danger/15 px-3 py-2 text-[11px] text-danger">{issueError}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}