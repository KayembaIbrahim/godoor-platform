"use client";

import { useState, useEffect } from "react";
import {
  ShieldCheck, Check, X, Loader2, Store, FileEdit, History
} from "lucide-react";

interface NameReq {
  id: string;
  merchant_id: string;
  merchant_name?: string;
  old_name: string;
  new_name: string;
  reason: string;
  status: string;
  admin_note?: string;
  reviewed_at?: string;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-danger/15 text-danger",
};

export default function AdminBusinessNamesPage() {
  const [requests, setRequests] = useState<NameReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/business-name-requests", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setRequests(d.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(true);
    setReviewingId(id);
    try {
      const res = await fetch("/api/admin/business-name-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, admin_note: note || (decision === "approved" ? "Approved" : "Rejected by admin") }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Review failed");
      }
    } catch {}
    setNote("");
    setReviewingId(null);
    setBusy(false);
    load();
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6 pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-go" /> Business Name Changes
          </h1>
          <p className="text-sm text-muted mt-1">Approve or reject rename requests from businesses</p>
        </div>
        {pendingCount > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1.5 text-xs font-bold text-warning">
            <FileEdit className="h-3 w-3" /> {pendingCount} pending
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-go" />
        </div>
      ) : requests.length === 0 ? (
        <div className="py-12 text-center">
          <Store className="mx-auto h-8 w-8 text-dim" />
          <p className="mt-2 text-sm text-muted">No name change requests yet</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {requests.map((req) => (
            <div key={req.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{req.merchant_name || req.old_name || "Business"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[req.status] || "bg-elevated text-muted"}`}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-dim mt-0.5">Merchant: {req.merchant_id.slice(0, 12)}…</p>
                  <p className="text-[10px] text-dim">Submitted: {new Date(req.created_at).toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-bg px-3 py-2.5 border border-danger/20">
                  <p className="text-[10px] text-dim uppercase">Current Name</p>
                  <p className="text-sm font-semibold text-danger truncate">{req.old_name || "—"}</p>
                </div>
                <div className="rounded-xl bg-bg px-3 py-2.5 border border-success/20">
                  <p className="text-[10px] text-dim uppercase">Requested Name</p>
                  <p className="text-sm font-semibold text-success truncate">{req.new_name}</p>
                </div>
              </div>

              {req.reason && (
                <p className="mt-2 rounded-xl bg-elevated px-3 py-2 text-xs text-muted">
                  <span className="font-semibold text-fg">Reason:</span> {req.reason}
                </p>
              )}

              {req.status === "pending" && (
                <div className="mt-3 border-t border-border pt-3">
                  <input
                    type="text"
                    value={reviewingId === req.id ? note : ""}
                    onChange={(e) => { setReviewingId(req.id); setNote(e.target.value); }}
                    placeholder="Admin note (optional)"
                    className="w-full rounded-xl bg-bg border border-border px-3 py-2 text-xs placeholder:text-dim outline-none focus:ring-2 focus:ring-go/40"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => decide(req.id, "approved")} disabled={busy && reviewingId === req.id}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2.5 text-xs font-semibold text-white hover:bg-success/90 transition disabled:opacity-50">
                      {busy && reviewingId === req.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                    </button>
                    <button type="button" onClick={() => decide(req.id, "rejected")} disabled={busy && reviewingId === req.id}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-danger/15 border border-danger/30 py-2.5 text-xs font-semibold text-danger hover:bg-danger/25 transition disabled:opacity-50">
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                </div>
              )}

              {(req.admin_note || req.reviewed_at) && (
                <div className="mt-2 rounded-xl bg-bg p-2.5">
                  {req.admin_note && (
                    <p className="text-xs text-fg"><span className="text-[10px] font-medium text-muted">Note:</span> {req.admin_note}</p>
                  )}
                  {req.reviewed_at && (
                    <p className="mt-0.5 text-[10px] text-dim">Reviewed: {new Date(req.reviewed_at).toLocaleString()}</p>
                  )}
                </div>
              )}

              {req.status === "approved" && (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-success">
                  <History className="h-3 w-3" /> Name now live. Next change eligible 30 days after this review.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}