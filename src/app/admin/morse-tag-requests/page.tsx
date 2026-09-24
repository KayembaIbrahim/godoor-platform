"use client";

import { useState, useEffect } from "react";
import {
  Check, X, Loader2, Phone, Mail, AlertTriangle
} from "lucide-react";
import { MorseLogo } from "@/components/MorseLogo";

interface MorseTagReq {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  user_role: string;
  kind: "profile" | "merchant";
  merchant_id: string;
  merchant_name: string;
  current_tag: string;
  requested_tag: string;
  contact_phone: string;
  contact_channel: string;
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

const KIND_LABEL: Record<string, string> = { profile: "Account", merchant: "Business" };

export default function AdminMorseTagRequestsPage() {
  const [requests, setRequests] = useState<MorseTagReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [note, setNote] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/morse/change-request?status=${filter}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setRequests(d.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setErr(null);
    setBusy(true);
    setReviewingId(id);
    try {
      const res = await fetch("/api/morse/change-request", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: decision, admin_note: note || (decision === "approved" ? "Approved after contacting the user" : "Rejected by admin") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data?.error?.message || data?.error || "Review failed");
    } catch {}
    setNote("");
    setReviewingId(null);
    setBusy(false);
    load();
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6 pb-24 md:pb-0 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <MorseLogo markOnly className="h-6 w-6 text-go" /> Morse Tag Changes
          </h1>
          <p className="text-sm text-muted mt-1">
            Every Morse tag is set once. A change here means support has to reach the user first — approve only after
            verifying the request is genuinely theirs.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["pending", "approved", "rejected"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === f ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
              {f === "pending" && pendingCount > 0 ? `Pending (${pendingCount})` : f}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-danger" /><p className="text-xs font-semibold text-danger">{err}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-go" />
        </div>
      ) : requests.length === 0 ? (
        <div className="py-12 text-center">
          <MorseLogo markOnly className="mx-auto h-8 w-8 text-dim" />
          <p className="mt-2 text-sm text-muted">No {filter} Morse tag change requests</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {requests.map((req) => (
            <div key={req.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{req.kind === "merchant" ? req.merchant_name || "Business" : req.user_name || req.user_email || "Account"}</span>
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-semibold text-muted">{KIND_LABEL[req.kind] || req.kind}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[req.status] || "bg-elevated text-muted"}`}>
                      {req.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-dim mt-0.5 truncate">{req.user_email || req.user_id}</p>
                  <p className="text-[10px] text-dim">Submitted: {new Date(req.created_at).toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-bg px-3 py-2.5 border border-danger/20 overflow-hidden">
                  <p className="text-[10px] text-dim uppercase">Current Tag</p>
                  <p className="text-sm font-mono font-semibold text-danger truncate">@{String(req.current_tag).replace(/^@/, "")}</p>
                </div>
                <div className="rounded-xl bg-bg px-3 py-2.5 border border-success/20 overflow-hidden">
                  <p className="text-[10px] text-dim uppercase">Requested Tag</p>
                  <p className="text-sm font-mono font-semibold text-success truncate">@{String(req.requested_tag).replace(/^@/, "")}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {req.contact_channel === "phone" && req.contact_phone ? (
                  <span className="flex items-center gap-1 rounded-lg bg-go/10 px-2 py-1 text-[10px] font-semibold text-go">
                    <Phone className="h-3 w-3" /> Reach at {req.contact_phone}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-lg bg-go/10 px-2 py-1 text-[10px] font-semibold text-go">
                    <Mail className="h-3 w-3" /> Reach at {req.user_email || "email"}
                  </span>
                )}
                <span className="text-[10px] text-dim">role: {req.user_role}</span>
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
                  {req.admin_note && <p className="text-xs text-fg"><span className="text-[10px] font-medium text-muted">Note:</span> {req.admin_note}</p>}
                  {req.reviewed_at && <p className="mt-0.5 text-[10px] text-dim">Reviewed: {new Date(req.reviewed_at).toLocaleString()}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}