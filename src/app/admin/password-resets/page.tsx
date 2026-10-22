"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Search, KeyRound, Trash2, CheckCircle2, X, ShieldCheck, Loader2, Clock, Ban, Copy, Check,
} from "lucide-react";

type Code = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: "active" | "used" | "expired" | "revoked";
  attempts: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  issued_by: string;
};

const STATUS_BADNESS: Record<Code["status"], string> = {
  active: "bg-success/15 text-success",
  used: "bg-elevated text-muted",
  expired: "bg-border text-muted",
  revoked: "bg-danger/15 text-danger",
};
const STATUS_TEXT: Record<Code["status"], string> = {
  active: "Active",
  used: "Used",
  expired: "Expired",
  revoked: "Revoked",
};

function formatDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function ttlText(expiresAt: string): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expires now";
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours >= 24) return `Expires in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `Expires in ${hours}h ${mins % 60}m`;
  return `Expires in ${mins}m`;
}

export default function AdminPasswordResets() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Issue modal
  const [issueOpen, setIssueOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [candidates, setCandidates] = useState<{ id: string; email: string; name: string; role: string; source: "rider" | "user" }[]>([]);
  const [selected, setSelected] = useState<{ id: string; email: string; name: string; role: string } | null>(null);
  const [newCode, setNewCode] = useState("");
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [issueError, setIssueError] = useState("");

  const refresh = useCallback(() => {
    fetch("/api/admin/password-resets", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (Array.isArray(d.codes)) setCodes(d.codes); else setCodes([]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const searchByQuery = async (query: string) => {
    setQ(query);
    if (!query.trim()) return setCandidates([]);
    const res = await fetch("/api/admin/password-resets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", query }),
    });
    const d = await res.json().catch(() => ({}));
    setCandidates(Array.isArray(d.candidates) ? d.candidates : []);
  };

  const doIssue = async () => {
    if (!selected) return;
    setIssueError("");
    setBusyId(selected.id);
    try {
      const res = await fetch("/api/admin/password-resets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selected.id, email: selected.email, name: selected.name, role: selected.role }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok && d.code) {
        setNewCode(d.code);
        setIssueOpen(true);
      } else {
        setIssueError(d?.error || "Could not issue a reset code.");
      }
    } catch {
      setIssueError("Could not reach the server.");
    }
    setBusyId(null);
  };

  const copyMessage = async () => {
    if (!newCode || !selected) return;
    const text =
      `GoDoor — Reset your password${selected.name ? `\n\nHi ${selected.name},` : ""}\n\n` +
      `Link to reset your password: ${window.location.origin}/reset-password?token=${selected.id}\n` +
      `One-time code: ${newCode}\n` +
      `This code expires in 24 hours and can only be used once.\n\n` +
      `If you did not request this, ignore this message.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 1500);
    } catch {}
  };

  const revoke = async (id: string) => {
    await fetch("/api/admin/password-resets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    refresh();
  };

  return (
    <div className="pb-20 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Password Resets</h1>
          <p className="mt-0.5 text-sm text-muted">One-time codes. Each is valid for 24 hours and usable once.</p>
        </div>
        <Link
          href="/admin/users"
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-elevated hover:text-fg"
        >
          Users
        </Link>
      </div>

      <div className="relative mt-5 mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
        <input
          value={q}
          onChange={(e) => searchByQuery(e.target.value)}
          placeholder="Search riders or customers…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3 text-sm outline-none ring-go focus:ring-2"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-left text-[11px]">
          <thead className="border-b border-border bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium hidden sm:table-cell">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium hidden md:table-cell">Issued</th>
              <th className="px-3 py-2 font-medium hidden lg:table-cell">Code state</th>
              <th className="w-20 px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-dim">Loading…</td></tr>
            ) : codes.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-dim">No reset codes yet.</td></tr>
            ) : codes.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2 text-dim hidden sm:table-cell">{c.email}</td>
                <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${STATUS_TEXT[c.status] === "Active" ? STATUS_BADNESS[c.status] : c.status === "revoked" ? STATUS_BADNESS[c.status] : STATUS_TEXT[c.status]}`}>
                  {c.status === "active" && <CheckCircle2 className="h-2.5 w-2.5" />}
                  {c.status === "used" && <CheckCircle2 className="h-2.5 w-2.5 opacity-50" />}
                  {c.status === "expired" && <Clock className="h-2.5 w-2.5 opacity-60" />}
                  {c.status === "revoked" && <Ban className="h-2.5 w-2.5" />}
                  {STATUS_TEXT[c.status]}
                </span></td>
                <td className="px-3 py-2 text-dim hidden md:table-cell">{formatDateTime(c.created_at).replace("T", " ").slice(0, 16)}</td>
                <td className="px-3 py-2 text-dim hidden lg:table-cell">{ttlText(c.expires_at)}</td>
                <td className="px-3 py-2">
                  {(c.status === "active" || c.status === "expired") && (
                    <button
                      type="button"
                      onClick={() => revoke(c.id)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
                    >
                      <Trash2 className="h-3 w-3" /> Revoke
                    </button>
                  )}
                  {c.attempts > 0 && c.status !== "used" && (
                    <span className="ml-1 text-[10px] text-warning">×{c.attempts}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Issue flow */}
      {!issueOpen && !searchOpen && (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-warning/15 py-3 text-xs font-medium text-amber-600 transition hover:bg-warning/25"
        >
          <KeyRound className="h-3.5 w-3.5" /> Send a reset code to someone
        </button>
      )}

      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">Find a person</h3>
              <button type="button" onClick={() => setSearchOpen(false)} className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              The code can be issued for a rider, customer or business owner. Search by name or email.
            </p>
            <input
              autoFocus
              value={q}
              onChange={(e) => searchByQuery(e.target.value)}
              placeholder="Search name or email…"
              className="mt-3 w-full rounded-xl border border-border bg-surface-2 py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-go focus:ring-2"
            />
            <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-border">
              {candidates.length === 0 && <li className="py-3 text-center text-xs text-dim">No matches. Try again or pick an existing user.</li>}
              {candidates.map((c) => (
                <li
                  key={c.id}
                  onClick={() => setSelected({ id: c.id, email: c.email, name: c.name, role: c.role })}
                  className={`cursor-pointer px-3 py-2.5 transition ${selected?.id === c.id ? "bg-go/15" : "hover:bg-surface-2"}`}
                >
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className="block text-[11px] text-dim">{c.role} · {c.email}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-right text-[11px] text-muted">Enter to pick · Esc to cancel</p>
          </div>
        </div>
      )}

      {issueOpen && newCode && (
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 p-4" onClick={() => setIssueOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-amber-500" />
                <h3 className="font-display text-sm font-bold">Reset code ready</h3>
              </div>
              <button type="button" onClick={() => setIssueOpen(false)} className="rounded-lg p-1.5 text-muted transition hover:bg-elevated hover:text-fg"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-[11px] text-muted">Copy the message the rider needs to send to themselves.</p>
            <div className="my-3 rounded-xl bg-surface-2 p-3 text-xs">
              <p className="mb-1 text-muted">Link</p>
              <code className="break-all">{window.location.origin}/reset-password?token={selected?.id}</code>
              <p className="mt-2 mb-1 text-muted">One-time code</p>
              <p className="font-mono tracking-wider text-fg">{newCode}</p>
              <p className="mt-3 text-[11px] text-dim">Valid for 24 hours · once only</p>
            </div>
            <button
              type="button"
              onClick={copyMessage}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-go py-2.5 text-sm font-semometric bold text-white transition hover:bg-go-2 disabled:opacity-70"
            >
              {copiedMsg ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              {copiedMsg ? "Copied" : "Copy & relay to the rider"}
            </button>
            <p className="mt-2 text-center text-[10px] text-dim">Send this out over WhatsApp, SMS or email — not from this screen, where it stays.</p>
          </div>
        </div>
      )}
    </div>
  );
}
