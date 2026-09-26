"use client";

import { useState, useEffect } from "react";
import {
  ShieldCheck, Check, CheckCircle2, X, Eye, FileImage, FileText, Clock, Loader2, Phone,
  ExternalLink
} from "lucide-react";

type FilterStatus = "all" | "pending" | "approved" | "rejected";

interface Doc {
  id: string;
  user_id: string;
  role: string;
  document_type: string;
  file_url: string;
  file_name: string;
  status: string;
  admin_note: string;
  reviewed_by: string;
  created_at: number;
  updated_at: number;
  user_name?: string;
  user_email?: string;
}

export default function AdminVerificationsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [roleFilter, setRoleFilter] = useState<"all" | "business" | "rider">("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showImage, setShowImage] = useState<string | null>(null);
  const [phoneRequests, setPhoneRequests] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"docs" | "phone">("docs");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const loadDocs = () => {
    setLoading(true);
    fetch("/api/admin/verification-docs", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.docs) setDocs(d.docs);
        else setDocs([]);
        setLoading(false);
      })
      .catch(() => { setDocs([]); setLoading(false); });
  };

  useEffect(() => { loadDocs(); }, []);
  useEffect(() => {
    fetch("/api/phone-change-request?status=pending", { cache: "no-store" })
      .then((r) => r.json())
      .then(({ requests }) => setPhoneRequests(requests || []))
      .catch(() => {});
  }, []);

  const handleApprove = async (docId: string) => {
    setBusyId(docId);
    const doc = docs.find(d => d.id === docId);
    let ok = false;
    try {
      const res = await fetch("/api/admin/verification-docs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId, status: "approved", admin_note: note || "Approved", user_id: doc?.user_id, role: doc?.role }),
      });
      ok = res.ok;
    } catch {}
    if (doc) finishReview(doc, "approved", ok);
    else { setBusyId(null); loadDocs(); }
  };

  const handleReject = async (docId: string) => {
    setBusyId(docId);
    const doc = docs.find(d => d.id === docId);
    let ok = false;
    try {
      const res = await fetch("/api/admin/verification-docs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId, status: "rejected", admin_note: note || "Rejected", user_id: doc?.user_id, role: doc?.role }),
      });
      ok = res.ok;
    } catch {}
    if (doc) finishReview(doc, "rejected", ok);
    else { setBusyId(null); loadDocs(); }
  };

  // Keep the just-reviewed document visible (switch off the pending-only filter)
  // and confirm the outcome instead of silently dropping the card.
  const finishReview = (doc: Doc, status: string, ok: boolean) => {
    const label = (DOC_LABELS[doc.document_type] || doc.document_type);
    const who = doc.user_name || "user";
    setNote("");
    setBusyId(null);
    loadDocs();
    if (ok) {
      setActionErr(null);
      setActionMsg(`${label} ${status} for ${who}.`);
      if (filter === "pending") setFilter("all");
    } else {
      setActionMsg(null);
      setActionErr(`Could not update ${label} for ${who}. Check your session and try again.`);
    }
  };

  const approvePhone = async (id: string, userId: string, userRole: string, newPhone: string) => {
    await fetch("/api/phone-change-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "approved", user_id: userId, user_role: userRole, new_phone: newPhone, admin_note: "Approved" }),
    });
    setPhoneRequests((prev) => prev.filter((r) => r.id !== id));
  };

  const rejectPhone = async (id: string, note: string) => {
    await fetch("/api/phone-change-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "rejected", admin_note: note || "Rejected" }),
    });
    setPhoneRequests((prev) => prev.filter((r) => r.id !== id));
  };

  const filtered = docs.filter((d) => {
    if (filter !== "all" && d.status !== filter) return false;
    if (roleFilter !== "all" && d.role !== roleFilter) return false;
    return true;
  });

  const pendingCount = docs.filter((d) => d.status === "pending").length;
  const statusCount = (s: FilterStatus) => s === "all" ? docs.length : docs.filter((d) => d.status === s).length;

  const DOC_LABELS: Record<string, string> = {
    shop_photo: "Shop Photo",
    trade_licence: "Trade Licence",
    national_id: "National ID",
    vehicle_photo: "Vehicle Photo",
  };

  const STATUS_STYLE: Record<string, string> = {
    pending: "bg-warning/15 text-warning",
    approved: "bg-success/15 text-success",
    rejected: "bg-danger/15 text-danger",
  };

  const isImageUrl = (url: string) =>
    url.startsWith("data:image/") || url.match(/\.(jpg|jpeg|png|gif|webp|svg)/i) || url.includes("supabase.co/storage");

  return (
    <div className="space-y-6 pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-go" /> Verifications
          </h1>
          <p className="text-sm text-muted mt-1">Review documents & phone change requests</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1.5 text-xs font-bold text-warning">
              <Clock className="h-3 w-3" /> {pendingCount} docs
            </span>
          )}
          {phoneRequests.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary">
              <Phone className="h-3 w-3" /> {phoneRequests.length} phones
            </span>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setActiveTab("docs")}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition ${activeTab === "docs" ? "bg-go text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
          <FileText className="h-3.5 w-3.5" /> Documents ({pendingCount})
        </button>
        <button type="button" onClick={() => setActiveTab("phone")}
          className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition ${activeTab === "phone" ? "bg-primary text-white" : "bg-surface text-muted hover:bg-elevated"}`}>
          <Phone className="h-3.5 w-3.5" /> Phone Requests ({phoneRequests.length})
        </button>
      </div>

      {/* Phone Change Requests */}
      {activeTab === "phone" && (
        <div className="space-y-3">
          {phoneRequests.length === 0 ? (
            <div className="py-12 text-center">
              <Phone className="mx-auto h-8 w-8 text-dim" />
              <p className="mt-2 text-sm text-muted">No pending phone change requests</p>
            </div>
          ) : phoneRequests.map((req: any) => (
            <div key={req.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10">
                  <Phone className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{req.user_name || "User"}</p>
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-[9px] font-semibold text-muted capitalize">{req.user_role}</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">{req.user_email}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-bg px-3 py-2.5">
                  <p className="text-[10px] text-dim uppercase">Old Number</p>
                  <p className="text-sm font-semibold text-danger">{req.old_phone}</p>
                </div>
                <div className="rounded-xl bg-bg px-3 py-2.5">
                  <p className="text-[10px] text-dim uppercase">New Number</p>
                  <p className="text-sm font-semibold text-success">{req.new_phone}</p>
                </div>
              </div>
              {req.reason && <p className="mt-2 text-xs text-muted italic">Reason: {req.reason}</p>}
              <p className="mt-1 text-[10px] text-dim">Submitted: {new Date(req.created_at).toLocaleString()}</p>
              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <button type="button" onClick={() => approvePhone(req.id, req.user_id, req.user_role, req.new_phone)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-success py-2.5 text-xs font-semibold text-white hover:bg-success/90 transition">
                  <Check className="h-3.5 w-3.5" /> Approve
                </button>
                <button type="button" onClick={() => rejectPhone(req.id, "Rejected by admin")}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-danger/15 border border-danger/30 py-2.5 text-xs font-semibold text-danger hover:bg-danger/25 transition">
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document Verification */}
      {activeTab === "docs" && (<>
      {/* Review outcome banner */}
      {actionMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/15 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <p className="flex-1 text-xs font-semibold text-success">{actionMsg}</p>
          <button type="button" onClick={() => setActionMsg(null)} className="rounded-lg p-1.5 text-success/70 transition hover:bg-success/10 hover:text-success">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {actionErr && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-danger" />
          <p className="flex-1 text-xs font-semibold text-danger">{actionErr}</p>
          <button type="button" onClick={() => setActionErr(null)} className="rounded-lg p-1.5 text-danger/70 transition hover:bg-danger/10 hover:text-danger">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "approved", "rejected"] as FilterStatus[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
              filter === f ? "bg-go text-white shadow-sm" : "bg-surface text-muted hover:bg-elevated"
            }`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== "all" && statusCount(f) > 0 && (
              <span className="ml-1.5 h-4 min-w-4 inline-flex items-center justify-center rounded-full bg-white/20 px-1 text-[9px]">{statusCount(f)}</span>
            )}
          </button>
        ))}
        <div className="w-px bg-border mx-1" />
        {(["all", "business", "rider"] as const).map((r) => (
          <button key={r} type="button" onClick={() => setRoleFilter(r)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
              roleFilter === r ? "bg-primary text-white shadow-sm" : "bg-surface text-muted hover:bg-elevated"
            }`}>
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-go" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-dim" />
          <p className="mt-2 text-sm text-muted">No verification documents to review</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((doc) => (
            <div key={doc.id} className="rounded-2xl border border-border bg-surface p-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      doc.role === "business" ? "bg-primary/15 text-primary" : "bg-primary/15 text-primary"
                    }`}>{doc.role}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[doc.status]}`}>
                      {doc.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold">{DOC_LABELS[doc.document_type] || doc.document_type}</p>
                  <p className="mt-1 text-xs text-fg font-medium">
                    {doc.user_name || "User"} {doc.user_email ? `(${doc.user_email})` : ""}
                  </p>
                  <p className="text-[10px] text-dim">User ID: {doc.user_id.slice(0, 12)}…</p>
                  <p className="text-[10px] text-dim">File: {doc.file_name || "unknown"}</p>
                  <p className="text-[10px] text-dim">Submitted: {new Date(doc.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Document preview */}
              {doc.file_url && (
                <div className="mt-3">
                  {isImageUrl(doc.file_url) ? (
                    <button type="button" onClick={() => setShowImage(doc.file_url)}
                      className="relative h-40 w-full overflow-hidden rounded-xl bg-bg border border-border group">
                      <img
                        src={doc.file_url}
                        alt={DOC_LABELS[doc.document_type] || "Document"}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          // If image fails to load, show a link instead
                          const target = e.target as HTMLImageElement;
                          target.style.display = "none";
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `<div class="flex items-center gap-2 p-3 text-xs text-muted"><span>Image preview unavailable</span><a href="${doc.file_url}" target="_blank" rel="noopener" class="ml-auto text-go hover:underline">Open link ↗</a></div>`;
                          }
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition">
                        <Eye className="h-6 w-6 text-white" />
                      </div>
                    </button>
                  ) : (
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-xl bg-bg border border-border p-3 hover:bg-elevated transition">
                      <FileImage className="h-4 w-4 text-go" />
                      <span className="text-xs font-medium">View document</span>
                      <ExternalLink className="h-3 w-3 text-muted ml-auto" />
                    </a>
                  )}
                </div>
              )}

              {/* Admin note input */}
              {doc.status === "pending" && (
                <div className="mt-3">
                  <input
                    type="text"
                    value={reviewingId === doc.id ? note : ""}
                    onFocus={() => { if (reviewingId !== doc.id) { setReviewingId(doc.id); setNote(""); } }}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Admin note (optional)"
                    className="w-full rounded-xl bg-bg border border-border px-3 py-2 text-xs placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-go/40"
                  />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => handleApprove(doc.id)}
                      disabled={busyId === doc.id}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success py-2.5 text-xs font-semibold text-white hover:bg-success/90 transition disabled:opacity-50">
                      {busyId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {busyId === doc.id ? "Saving…" : "Approve"}
                    </button>
                    <button type="button" onClick={() => handleReject(doc.id)}
                      disabled={busyId === doc.id}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-danger/15 border border-danger/30 py-2.5 text-xs font-semibold text-danger hover:bg-danger/25 transition disabled:opacity-50">
                      {busyId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} {busyId === doc.id ? "Saving…" : "Reject"}
                    </button>
                  </div>
                </div>
              )}

              {doc.admin_note && (
                <div className="mt-2 rounded-xl bg-bg p-2.5">
                  <p className="text-[10px] font-medium text-muted">Admin note:</p>
                  <p className="text-xs text-fg">{doc.admin_note}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      </>)}
      {/* Full-screen image viewer */}
      {showImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4" onClick={() => setShowImage(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <button type="button" onClick={() => setShowImage(null)}
              className="absolute -top-3 -right-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface border border-border shadow-lg">
              <X className="h-4 w-4" />
            </button>
            <img src={showImage} alt="Document" className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
