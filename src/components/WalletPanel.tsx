"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  CheckCircle2,
  Copy,
  Gift,
  Loader2,
  Smartphone,
  Wallet,
  KeyRound,
  Send,
  ExternalLink,
  ShieldCheck,
  Clock,
  Package,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { useSession } from "@/lib/session-store";
import { apiAuthHeaders } from "@/lib/db";
import { MorseLogo } from "@/components/MorseLogo";

type EscrowWallet = {
  user_id: string;
  available_balance: number;
  escrow_balance: number;
};

type EscrowLedgerRow = {
  id: string;
  type: "deposit" | "order_hold" | "order_release" | "commission" | "rider_payout" | "refund";
  amount: number;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
};

type MorseConfig = {
  handle: string;
  referralCode: string;
  downloadUrl: string;
  rateUgx: number;
};

type ActiveDeposit = {
  depositId: string;
  referenceCode: string;
  amount: number;
  status: string;
  morseUsername: string;
  instructions: string;
  message?: string;
};

const QUICK_UGX = [5000, 10000, 20000, 50000, 100000];

const LEDGER_LABEL: Record<string, string> = {
  deposit: "Wallet top-up",
  order_hold: "Order payment (escrow)",
  order_release: "Escrow released",
  commission: "Platform commission",
  rider_payout: "Rider payout",
  refund: "Refund",
};

const CREDIT_TYPES = new Set(["deposit", "refund"]);

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
}

function usd(ugx: number, rate: number): string {
  const r = rate > 0 ? rate : 3800;
  return `$${(ugx / r).toFixed(2)}`;
}

/* ── Rate strip — always shows the live UGX/USD rate ─────────────── */
function LiveRate({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-elevated/60 px-3 py-2">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-go" />
      </span>
      <p className="text-[11px] font-medium text-muted">
        Live rate · 1 USD = <span className="num font-bold text-fg">{formatUgx(rate)}</span> UGX
      </p>
    </div>
  );
}

/* ── Balance card ─────────────────────────────────────────────── */
function BalanceCard({ wallet, rate }: { wallet: EscrowWallet | null; rate: number }) {
  const available = wallet?.available_balance || 0;
  const escrow = wallet?.escrow_balance || 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">Available balance</p>
          {/* UGX is the headline number — most Ugandans do not think in USD. */}
          <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-go">
            {wallet ? formatUgx(available) : "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted tabular-nums">
            {wallet ? `${usd(available, rate)} USD` : "Loading…"}
          </p>
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-go/15 text-go">
          <Wallet className="h-6 w-6" />
        </div>
      </div>

      {escrow > 0 && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold tabular-nums text-warning">
              {formatUgx(escrow)} <span className="text-xs font-normal text-muted">({usd(escrow, rate)} USD)</span> in escrow
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              Held safely until delivery is confirmed. You are refunded in full if an order is cancelled.
            </p>
          </div>
        </div>
      )}

      <div className="mt-4">
        <LiveRate rate={rate} />
      </div>
    </div>
  );
}

/* ── Ledger history ───────────────────────────────────────────── */
function LedgerCard({ rows, rate }: { rows: EscrowLedgerRow[]; rate: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="font-display text-base font-semibold">Wallet history</h2>
      <p className="mt-0.5 text-[11px] text-muted">Every balance change is recorded — nothing happens silently.</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No activity yet. Top up to get started.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => {
            const credit = CREDIT_TYPES.has(r.type);
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 rounded-xl bg-elevated/50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                    {r.type === "deposit" && <Gift className="h-3 w-3 text-success" />}
                    {LEDGER_LABEL[r.type] || r.type}
                  </p>
                  <p className="mt-0.5 text-[10px] text-dim">
                    {new Date(r.created_at).toLocaleString("en-UG")}
                    {r.ref_id ? ` · ${String(r.ref_id).slice(0, 8)}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`num text-xs font-bold tabular-nums ${credit ? "text-success" : "text-fg"}`}>
                    {credit ? "+" : "−"}{formatUgx(Math.abs(r.amount))}
                  </p>
                  <p className="text-[9px] text-dim tabular-nums">
                    {credit ? `+${usd(r.amount, rate)}` : `−${usd(Math.abs(r.amount), rate)}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Morse top-up (escrow deposit) ────────────────────────────── */
function TopUpCard({ rate, onDeposited }: { rate: number; onDeposited: () => void }) {
  const [amount, setAmount] = useState(10000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<MorseConfig | null>(null);
  const [deposit, setDeposit] = useState<ActiveDeposit | null>(null);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    fetch("/api/morse").then((r) => r.json()).then((j) => { if (j.config) setCfg(j.config); }).catch(() => {});
  }, []);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/topup/morse/init", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ amount }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message || json.error || "Could not start top-up"); return; }
      setDeposit(json.data);
      setReported(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reportSent() {
    if (!deposit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/topup/morse/i-have-sent", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ referenceCode: deposit.referenceCode }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message || json.error || "Could not report"); return; }
      setReported(true);
      onDeposited();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (deposit && reported) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-6">
        <div className="flex items-center gap-2 text-success">
          <Clock className="h-5 w-5" />
          <h2 className="font-display text-lg font-semibold">Awaiting confirmation</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          We have your report for{" "}
          <span className="num font-mono font-semibold text-fg">{deposit.referenceCode}</span>. Our team verifies the
          Morse transfer, then your balance is credited. Nothing is credited before verification.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
            <dt className="text-muted">Amount</dt>
            <dd className="num font-semibold tabular-nums">{formatUgx(deposit.amount)}</dd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
            <dt className="text-muted">Status</dt>
            <dd className="text-xs font-semibold text-warning">Pending verification</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => { setDeposit(null); setReported(false); }}
          className="mt-4 text-sm font-semibold text-go hover:text-go-2"
        >
          Start another top-up
        </button>
      </div>
    );
  }

  if (deposit) {
    return (
      <div className="rounded-2xl border border-go/40 bg-elevated p-6">
        <div className="flex items-center gap-2 text-go-2">
          <Smartphone className="h-5 w-5" />
          <h2 className="font-display text-lg font-semibold">Send the money on Morse</h2>
        </div>
        <ol className="mt-3 space-y-2 text-sm text-muted">
          <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">1.</span> Open Morse and send exactly{" "}<span className="num font-semibold text-fg">{formatUgx(deposit.amount)}</span></li>
          <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">2.</span> Send it to <span className="font-mono font-semibold text-fg">{deposit.morseUsername}</span></li>
          <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">3.</span> Put this reference in the note: <span className="num font-mono font-semibold text-go">{deposit.referenceCode}</span></li>
        </ol>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
            <span className="text-xs text-muted">Morse username</span>
            <span className="flex items-center gap-1.5 font-mono text-sm font-semibold">
              {deposit.morseUsername}
              <button type="button" onClick={() => copyToClipboard(deposit.morseUsername)} aria-label="Copy Morse username" className="rounded p-1 text-muted hover:bg-elevated">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
            <span className="text-xs text-muted">Amount</span>
            <span className="flex items-center gap-2">
              <span className="num text-sm font-semibold tabular-nums">{formatUgx(deposit.amount)}</span>
              <span className="num text-[10px] text-dim">{usd(deposit.amount, rate)}</span>
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
            <span className="text-xs text-muted">Reference</span>
            <span className="flex items-center gap-1.5">
              <span className="num font-mono text-sm font-bold text-go">{deposit.referenceCode}</span>
              <button type="button" onClick={() => copyToClipboard(deposit.referenceCode)} aria-label="Copy reference" className="rounded p-1 text-muted hover:bg-elevated">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}

        <button
          type="button"
          disabled={busy}
          onClick={() => void reportSent()}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          I have sent it
        </button>
        <p className="mt-2 text-center text-[10px] text-dim">
          Tapping this does not credit your wallet. An admin verifies the transfer first.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex items-center gap-2">
        <MorseLogo markOnly className="h-5" />
        <h2 className="font-display text-lg font-semibold">Top up your wallet</h2>
      </div>
      <p className="mt-2 text-sm text-muted">
        Send money from your Morse wallet to GoDoor. An admin verifies the transfer, then your balance is credited.
      </p>

      <div className="mt-4">
        <span className="text-sm text-muted">Amount</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_UGX.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(q)}
              className={`num rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition ${
                amount === q ? "bg-go text-white" : "bg-panel text-muted hover:text-fg"
              }`}
            >
              {formatUgx(q)}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={1000}
          step={500}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          aria-label="Top-up amount in UGX"
          className="num mt-3 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm tabular-nums outline-none ring-go focus:ring-2"
        />
        <p className="num mt-1 text-xs text-dim tabular-nums">
          ≈ {usd(amount, rate)} USD · at {formatUgx(rate)} per USD
        </p>
      </div>

      {error && <p className="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}

      <button
        type="button"
        disabled={busy || amount < 1000}
        onClick={() => void start()}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownLeft className="h-4 w-4" />}
        Get reference · {formatUgx(amount)}
      </button>

      <div className="mt-4 rounded-xl border border-go/30 bg-go/5 p-4">
        <div className="flex items-center gap-2">
          <MorseLogo className="h-4" />
          <p className="text-xs font-semibold text-fg">No Morse wallet yet?</p>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          Download the Morse app and sign up with GoDoor&apos;s friend code{" "}
          <strong className="text-go">{cfg?.referralCode || "AsAp4f"}</strong>.
        </p>
        <a
          href={cfg?.downloadUrl || "https://morsemoney.com/download"}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-go/10 px-3 py-2 text-xs font-semibold text-go hover:bg-go/20"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Get Morse
        </a>
      </div>
    </div>
  );
}

/* ── Morse wallet identity ─────────────────────────────────────── */
function MorseIdentity() {
  const { profile, setProfile } = useSession();
  const [tag, setTag] = useState(profile.morseTag ?? "");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChange, setShowChange] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const valid = (t: string) => /^[a-z0-9_]{3,32}$/i.test(t.trim().replace(/^@/, ""));
  const matches = tag.trim().replace(/^@/, "") === confirm.trim().replace(/^@/, "") && confirm.trim() !== "";

  async function save() {
    if (!valid(tag) || !matches) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag: tag.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || "That Morse tag could not be saved."); return; }
      setProfile({ morseTag: j?.tag || tag.trim() });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function requestChange() {
    if (!valid(newTag)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag: newTag.trim(), contactPhone: phone.trim() || undefined, reason: reason.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setProfile({ morseTag: j?.tag || newTag.trim() });
        setShowChange(false);
        setNewTag(""); setPhone(""); setReason("");
        return;
      }
      setNote(j?.error || "Change request sent — support will contact you.");
      setShowChange(false);
      setNewTag(""); setPhone(""); setReason("");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (profile.morseTag) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center gap-2">
          <MorseLogo markOnly className="h-5" />
          <h2 className="font-display text-base font-semibold">Your Morse wallet</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          Linked to <span className="font-mono font-semibold text-fg">@{profile.morseTag.replace(/^@/, "")}</span>.
          This is the wallet your GoDoor balance is funded from and it is locked for safety.
        </p>
        {note && <p className="mt-3 rounded-xl bg-success/10 px-3 py-2 text-xs font-medium text-success">{note}</p>}
        {!showChange ? (
          <button
            type="button"
            onClick={() => setShowChange(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-go/10 px-3 py-2 text-xs font-semibold text-go hover:bg-go/20"
          >
            <KeyRound className="h-3.5 w-3.5" /> Request a change
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="New Morse username" className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none ring-go focus:ring-2" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone for support to reach you" className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none ring-go focus:ring-2" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none ring-go focus:ring-2" />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving || !valid(newTag)}
                onClick={() => void requestChange()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
              </button>
              <button type="button" onClick={() => setShowChange(false)} className="rounded-xl bg-elevated px-4 py-2.5 text-sm font-semibold text-muted hover:bg-bg">
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-go/40 bg-elevated p-6">
      <div className="flex items-center gap-2">
        <MorseLogo markOnly className="h-5" />
        <h2 className="font-display text-base font-semibold">Confirm your Morse wallet</h2>
      </div>
      <p className="mt-2 text-sm text-muted">
        Every GoDoor account is tied to one Morse username. This is what funds your wallet.
      </p>
      <div className="mt-4 space-y-2">
        <input value={tag} onChange={(e) => { setTag(e.target.value); setError(null); }} placeholder="Your Morse username" aria-label="Morse username" className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
        <input value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null); }} placeholder="Type it again to confirm" aria-label="Confirm Morse username" className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
        <button
          type="button"
          disabled={saving || !valid(tag) || !matches}
          onClick={() => void save()}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MorseLogo markOnly className="h-4" />}
          Confirm my Morse username
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────── */
export function WalletPanel() {
  const [wallet, setWallet] = useState<EscrowWallet | null>(null);
  const [ledger, setLedger] = useState<EscrowLedgerRow[]>([]);
  const [cfg, setCfg] = useState<MorseConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const rate = cfg?.rateUgx || 3800;

  const load = useCallback(async () => {
    try {
      const headers = await apiAuthHeaders(false);
      const [balRes, ledRes, cfgRes] = await Promise.all([
        fetch("/api/wallet/balance", { headers, cache: "no-store" }),
        fetch("/api/wallet/ledger", { headers, cache: "no-store" }),
        fetch("/api/morse"),
      ]);
      if (balRes.ok) setWallet((await balRes.json()).data);
      if (ledRes.ok) setLedger((await ledRes.json()).data || []);
      if (cfgRes.ok) {
        const j = await cfgRes.json().catch(() => ({}));
        if (j.config) setCfg(j.config);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div className="h-48 animate-pulse rounded-2xl bg-surface" />
          <div className="h-64 animate-pulse rounded-2xl bg-surface" />
        </div>
        <div className="lg:col-span-2"><div className="h-64 animate-pulse rounded-2xl bg-surface" /></div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-5">
      <section className="space-y-6 lg:col-span-3">
        <BalanceCard wallet={wallet} rate={rate} />
        <TopUpCard rate={rate} onDeposited={() => void load()} />
        <MorseIdentity />
      </section>

      <aside className="lg:col-span-2">
        <div className="space-y-6">
          <LedgerCard rows={ledger} rate={rate} />
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-go" /> How your money is protected
            </h2>
            <ol className="mt-3 space-y-2.5 text-[11px] text-muted">
              <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">1.</span> Your top-up only lands after an admin verifies the Morse transfer.</li>
              <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">2.</span> When you order, the total moves from your balance into escrow.</li>
              <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">3.</span> Escrow is released to the business and rider only on delivery.</li>
              <li className="flex gap-2"><span className="num shrink-0 font-bold text-go">4.</span> Cancel before delivery and the full amount returns to your balance.</li>
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}
