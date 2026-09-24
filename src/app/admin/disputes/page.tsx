"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, XCircle, Clock,
  MessageCircle, Shield, ChevronDown, Send
} from "lucide-react";
import { fetchDisputes, updateDispute, type DBDispute } from "@/lib/db";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-danger/15 text-danger",
  investigating: "bg-warning/15 text-warning",
  resolved: "bg-success/15 text-success",
  dismissed: "bg-elevated text-muted",
};

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<DBDispute[]>([]);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const refresh = () => fetch("/api/admin/disputes", { cache: "no-store" })
    .then((r) => r.ok ? r.json() : null)
    .then((d) => { if (d?.disputes) setDisputes(d.disputes); else fetchDisputes().then(setDisputes); })
    .catch(() => fetchDisputes().then(setDisputes));
  useEffect(() => { refresh(); }, []);

  const filtered = disputes.filter((d) => filter === "all" || d.status === filter).sort((a, b) => b.created_at - a.created_at);

  const counts = {
    all: disputes.length,
    open: disputes.filter((d) => d.status === "open").length,
    investigating: disputes.filter((d) => d.status === "investigating").length,
    resolved: disputes.filter((d) => d.status === "resolved").length,
    dismissed: disputes.filter((d) => d.status === "dismissed").length,
  };

  const resolveDispute = (id: string, status: string) => {
    updateDispute(id, { status, admin_note: note || `Marked as ${status} by admin` }).then(() => {
      setNote("");
      setExpanded(null);
      refresh();
    });
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold">Disputes</h1>
        {counts.open > 0 && (
          <span className="rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-bold text-danger">{counts.open} open</span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">Review and resolve payment disputes between customers and merchants.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["all", "open", "investigating", "resolved", "dismissed"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === f ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {filtered.map((d) => (
          <div key={d.id} className="rounded-2xl border border-border bg-surface p-4 transition">
            <div className="flex items-start gap-3">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                d.status === "open" ? "bg-danger/10" : d.status === "investigating" ? "bg-warning/10" : "bg-success/10"
              }`}>
                <AlertTriangle className={`h-5 w-5 ${
                  d.status === "open" ? "text-danger" : d.status === "investigating" ? "text-warning" : "text-success"
                }`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_COLORS[d.status] || "bg-elevated text-muted"}`}>
                    {d.status}
                  </span>
                  <span className="text-[10px] text-dim">#{d.order_id.slice(-8)}</span>
                </div>
                <p className="mt-1 text-sm font-medium">{d.reason}</p>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-dim">
                  <span>Raised by: {d.raised_by_name || "Unknown"}</span>
                  <span>·</span>
                  <span>{new Date(d.created_at).toLocaleString()}</span>
                </div>
                {d.admin_note && (
                  <div className="mt-2 rounded-xl bg-bg px-3 py-2">
                    <p className="text-[10px] text-dim font-medium">Admin note:</p>
                    <p className="text-xs text-muted">{d.admin_note}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            {d.status !== "resolved" && d.status !== "dismissed" && (
              <div className="mt-3 border-t border-border pt-3">
                {expanded === d.id ? (
                  <div className="space-y-2">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="Add admin note (optional)…"
                      className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2 resize-none"
                      rows={2} />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => resolveDispute(d.id, "resolved")}
                        className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-2 text-xs font-medium text-success hover:bg-success/25 transition">
                        <CheckCircle2 className="h-3 w-3" /> Resolve
                      </button>
                      <button type="button" onClick={() => resolveDispute(d.id, "dismissed")}
                        className="flex items-center gap-1.5 rounded-xl bg-elevated px-3 py-2 text-xs font-medium text-muted hover:bg-panel transition">
                        <XCircle className="h-3 w-3" /> Dismiss
                      </button>
                      <button type="button" onClick={() => resolveDispute(d.id, "investigating")}
                        className="flex items-center gap-1.5 rounded-xl bg-warning/15 px-3 py-2 text-xs font-medium text-warning hover:bg-warning/25 transition">
                        <Clock className="h-3 w-3" /> Investigating
                      </button>
                      <button type="button" onClick={() => { setExpanded(null); setNote(""); }}
                        className="rounded-xl bg-surface px-3 py-2 text-xs text-muted hover:bg-elevated transition">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setExpanded(d.id)}
                      className="flex items-center gap-1.5 rounded-xl bg-go/15 px-3 py-2 text-xs font-medium text-go hover:bg-go/25 transition">
                      <Shield className="h-3 w-3" /> Review & Act
                    </button>
                    <button type="button" onClick={() => resolveDispute(d.id, "resolved")}
                      className="flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-2 text-xs font-medium text-success hover:bg-success/25 transition">
                      <CheckCircle2 className="h-3 w-3" /> Quick Resolve
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm text-muted">No disputes found</p>
            <p className="mt-1 text-xs text-dim">All clear! Disputes raised by customers or merchants will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
