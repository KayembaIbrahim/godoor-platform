"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Wallet, Check, X, Clock, CheckCircle2, AlertTriangle, Loader2, Info, Camera
} from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { MorseLogo } from "@/components/MorseLogo";

interface TopupRequest {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  amount_ugx: number;
  phone: string;
  network: string;
  reference: string;
  method: "morse" | "momo";
  currency: "USDT" | "UGX";
  screenshot_url: string | null;
  status: "pending" | "credited" | "rejected";
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export default function AdminWalletCreditsPage() {
  const [pending, setPending] = useState<TopupRequest[]>([]);
  const [history, setHistory] = useState<TopupRequest[]>([]);
  const [usdt, setUsdt] = useState<{ handle: string; network: string; referralCode: string; downloadUrl: string; rateUgx: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/wallet-credits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) { setPending(d.pending || []); setHistory(d.history || []); setUsdt(d.usdt || null); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const settle = async (id: string, status: "credited" | "rejected") => {
    setBusyId(id);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/wallet-credits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, admin_note: notes[id] || (status === "credited" ? "Credited" : "Rejected") }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error || "Update failed"); setBusyId(null); return; }
      setMsg(json.credited ? "Wallet credited. Customer balance updated." : "Request rejected.");
      setNotes((n) => { const c = { ...n }; delete c[id]; return c; });
      load();
    } catch {
      setErr("Network error. Try again.");
      setBusyId(null);
    }
  };

  const netLabel = (n: string) => (n === "mtn_momo" ? "MTN" : n === "airtel_money" ? "Airtel" : n === "usdt" ? "Morse · USD" : n || "—");
  const amountLabel = (r: TopupRequest) => r.currency === "USDT" ? `$${r.amount_ugx} USD` : formatUgx(r.amount_ugx);

  return (
    <div className="space-y-6 pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-go" /> Wallet Credits
          </h1>
          <p className="text-sm text-muted mt-1">Customers send money to your number with a reference — verify and credit here.</p>
        </div>
        {pending.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1.5 text-xs font-bold text-warning">
            <Clock className="h-3 w-3" /> {pending.length} awaiting
          </span>
        )}
      </div>

      {/* Morse partner wallet */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <MorseLogo markOnly className="h-4 w-4 text-go" />
          <h2 className="text-sm font-semibold">Morse partner wallet</h2>
        </div>
        {usdt ? (
          <p className="mt-2 text-sm text-muted">
            Customers top up their own Morse wallet from mobile money, then send USD (Morse shows it as UGX) to{" "}
            <strong className="text-fg">{usdt.handle}</strong> with the reference as the note.
            Verify the transfer in the Morse app, then credit here.{" "}
            {usdt.referralCode && (
              <span className="text-xs text-dim">Referral: <code className="rounded bg-elevated px-1.5 py-0.5 text-go">{usdt.referralCode}</code> · 1 USD = {formatUgx(usdt.rateUgx)}</span>
            )}
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning/10 border border-warning/30 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Morse config missing. Set <code>MORSE_USERNAME=@Godoor</code> (and optionally <code>MORSE_REFERRAL_CODE</code>, <code>MORSE_DOWNLOAD_URL</code>, <code>USDT_TO_UGX_RATE</code>), then redeploy.</span>
          </p>
        )}
      </div>

      {msg && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/15 px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-success" /><p className="text-xs font-semibold text-success">{msg}</p>
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-danger" /><p className="text-xs font-semibold text-danger">{err}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-go" /></div>
      ) : pending.length === 0 ? (
        <div className="py-12 text-center">
          <Wallet className="mx-auto h-8 w-8 text-dim" />
          <p className="mt-2 text-sm text-muted">No top-ups waiting for verification</p>
          <p className="text-xs text-dim">When a customer sends money with a reference, it appears here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{r.user_name || "Customer"}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${r.method === "morse" ? "bg-go/15 text-go" : "bg-elevated text-muted"}`}>{r.method === "morse" ? "MORSE" : "MOMO"}</span>
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-[9px] font-semibold text-muted">{netLabel(r.network)}</span>
                    <span className="rounded-full bg-go/10 px-2 py-0.5 text-[9px] font-bold text-go font-mono">{r.reference}</span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">{r.user_email}</p>
                  <p className="text-xs text-muted mt-1">
                    Sent from <strong className="text-fg">{r.phone || "—"}</strong>
                  </p>
                  {r.screenshot_url && (
                    <a
                      href={r.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-go/10 px-2.5 py-1 text-xs font-semibold text-go hover:bg-go/20 transition"
                    >
                      <Camera /> View send screenshot
                    </a>
                  )}
                  <p className="text-[10px] text-dim mt-1">Requested: {new Date(r.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-xl font-bold text-go tabular-nums">{amountLabel(r)}</p>
                  <p className="text-[10px] text-muted">claimed amount</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={notes[r.id] || ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  placeholder="Admin note (e.g. MoMo txn id)"
                  className="min-w-0 flex-1 rounded-xl bg-bg border border-border px-3 py-2 text-xs placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-go/40"
                />
                <button type="button" disabled={busyId === r.id}
                  onClick={() => settle(r.id, "credited")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-success px-4 py-2 text-xs font-semibold text-white hover:bg-success/90 transition disabled:opacity-50">
                  {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Money received — credit
                </button>
                <button type="button" disabled={busyId === r.id}
                  onClick={() => settle(r.id, "rejected")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-danger/15 border border-danger/30 px-4 py-2 text-xs font-semibold text-danger hover:bg-danger/25 transition disabled:opacity-50">
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim">Recent settlements</h3>
          <div className="space-y-2">
            {history.slice(0, 20).map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  r.status === "credited" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                }`}>
                  {r.status === "credited" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                  {r.status}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{r.user_name || "Customer"} · {r.reference}</p>
                  <p className="text-[10px] text-dim">{new Date(r.created_at).toLocaleString()}{r.reviewed_by ? ` · by ${r.reviewed_by}` : ""}</p>
                </div>
                <p className="text-xs font-bold tabular-nums">{amountLabel(r)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-dim"><Info className="h-3.5 w-3.5" /> Crediting adds an immutable ledger row — a customer can never credit themselves.</p>
      )}
    </div>
  );
}