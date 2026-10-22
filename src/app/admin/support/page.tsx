"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LifeBuoy, KeyRound, Search, Loader2, Mail, Phone, ShieldCheck, Ban, CheckCircle2,
  Truck, Store, Users, ChevronRight, AlertCircle,
} from "lucide-react";

/**
 * The support desk.
 *
 * Everything else in the portal is a work queue. This is the screen an
 * operator opens when a person phones in with a problem — usually "I cannot
 * sign in" — and it answers the three questions that call actually needs:
 *
 *   1. Who is this person?      → search riders, merchants and customers
 *   2. What state is their account in?
 *   3. What do I do about it?    → the one-time reset code, in one click
 *
 * The reset itself lives on the Password Resets page so that every code
 * issued anywhere in the portal is visible in one audit list.
 */

type Candidate = {
  id: string;
  email: string;
  name: string;
  role: string;
  source: "rider" | "user";
};

type Code = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: "active" | "used" | "expired" | "revoked";
  created_at: string;
  expires_at: string;
};

export default function AdminSupport() {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [codes, setCodes] = useState<Code[]>([]);
  const [issued, setIssued] = useState<{ code: string; id: string; email: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCodes = useCallback(() => {
    fetch("/api/admin/password-resets", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => setCodes(Array.isArray(d.codes) ? d.codes : []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadCodes(); }, [loadCodes]);

  // Search as the operator types, but only once there is something to search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setCandidates([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/password-resets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query: q }),
        });
        const d = await res.json().catch(() => ({}));
        setCandidates(Array.isArray(d.candidates) ? d.candidates : []);
      } catch {
        setCandidates([]);
      }
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const issue = async (c: Candidate) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/password-resets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: c.id, email: c.email, name: c.name, role: c.role }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok && d.code) {
        setIssued({ code: d.code, id: d.id, email: d.email, name: d.name });
        loadCodes();
      } else {
        setError(d?.error || "Could not issue a reset code.");
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  };

  const activeCodes = codes.filter((c) => c.status === "active");

  return (
    <div className="pb-20 md:pb-0 animate-fade-in">
      <h1 className="font-display text-2xl font-bold">Support</h1>
      <p className="mt-1 text-sm text-muted">Find a person, check their account, and get them back in.</p>

      {/* ── Who needs help ─────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4 text-go" /> Find a person
        </h2>
        <p className="mt-1 text-xs text-muted">
          Search riders, customers and business owners by name or email.
        </p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or email…"
            autoComplete="off"
            className="w-full rounded-xl border border-border bg-surface-2 py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-go focus:ring-2 focus:ring-go/30"
          />
          {searching && <Loader2 className="h-4 w-4 animate-spin text-dim absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>

        {query.trim().length >= 2 && (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {candidates.length === 0 && !searching && (
              <li className="px-3 py-6 text-center text-xs text-dim">Nobody matches “{query.trim()}”.</li>
            )}
            {candidates.map((c) => {
              const Icon = c.role === "rider" ? Truck : c.role === "business" ? Store : Users;
              return (
                <li key={c.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-go/10">
                    <Icon className="h-4 w-4 text-go" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name || c.email}</p>
                    <p className="truncate text-[11px] text-dim">
                      <span className="capitalize">{c.role}</span> · {c.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => issue(c)}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-warning/15 px-3 py-2 text-xs font-medium text-amber-600 transition hover:bg-warning/25 disabled:opacity-50"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Reset code
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── The code that was just issued ──────────────────────────────────── */}
      {issued && (
        <section className="mt-4 rounded-2xl border border-warning/30 bg-warning/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-amber-500" /> Reset code for {issued.name || issued.email}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Send this code and the link to them — they set their own password. Valid for 24 hours,
            usable once.
          </p>
          <div className="mt-3 space-y-2 rounded-xl bg-bg p-3 text-xs">
            <p className="break-all text-muted">
              Link: <span className="text-fg">{typeof window !== "undefined" ? window.location.origin : ""}/reset-password?token={issued.id}</span>
            </p>
            <p className="text-muted">
              Code: <span className="font-mono font-bold tracking-wider text-fg">{issued.code}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const origin = typeof window !== "undefined" ? window.location.origin : "";
              navigator.clipboard.writeText(
                `GoDoor — Reset your password\n\nHi ${issued.name || "there"},\n\n` +
                `Link to reset your password: ${origin}/reset-password?token=${issued.id}\n` +
                `One-time code: ${issued.code}\n\n` +
                `This code expires in 24 hours and can only be used once.`,
              ).catch(() => {});
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-go py-2.5 text-xs font-semibold text-white transition hover:bg-go-2"
          >
            Copy the message
          </button>
        </section>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs text-muted">{error}</p>
        </div>
      )}

      {/* ── Outstanding codes ─────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-go" /> Outstanding reset codes
          </h2>
          <Link href="/admin/password-resets" className="flex items-center gap-1 text-xs font-medium text-go transition hover:underline">
            Manage all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {activeCodes.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-dim">
            No reset codes are waiting to be used.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {activeCodes.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-success/15">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{c.name || c.email}</p>
                  <p className="truncate text-[10px] text-dim">{c.email}</p>
                </div>
                <span className="shrink-0 text-[10px] capitalize text-dim">{c.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Common situations ─────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <LifeBuoy className="h-4 w-4 text-go" /> Common situations
        </h2>
        <dl className="mt-3 space-y-3 text-xs">
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="font-semibold">“I forgot my password.”</dt>
            <dd className="mt-1 leading-relaxed text-muted">
              Search for them above and press <span className="font-medium text-fg">Reset code</span>.
              Send them the code and the link; they choose their own password. Never read a
              password out over the phone — a code expires in 24 hours and works once, a spoken
              password does not expire at all.
            </dd>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="flex items-center gap-1.5 font-semibold">
              <Ban className="h-3.5 w-3.5 text-danger" /> “My account is blocked.”
            </dt>
            <dd className="mt-1 leading-relaxed text-muted">
              A reset code does not un-ban an account. Lift the ban first in{" "}
              <Link href="/admin/users" className="font-medium text-go hover:underline">Users</Link>,
              then issue the code.
            </dd>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="flex items-center gap-1.5 font-semibold">
              <Mail className="h-3.5 w-3.5 text-go" /> “They never got the email.”
            </dt>
            <dd className="mt-1 leading-relaxed text-muted">
              GoDoor does not send the email for you — the portal generates the code and link, and
              you send them by WhatsApp, SMS or email yourself. Issue a fresh code and send that.
            </dd>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <dt className="flex items-center gap-1.5 font-semibold">
              <Phone className="h-3.5 w-3.5 text-go" /> “They have no phone number.”
            </dt>
            <dd className="mt-1 leading-relaxed text-muted">
              A code is tied to an <span className="font-medium text-fg">email</span> address, not a
              phone number. If the account has no email, add one in{" "}
              <Link href="/admin/users" className="font-medium text-go hover:underline">Users</Link>{" "}
              before issuing a code.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
