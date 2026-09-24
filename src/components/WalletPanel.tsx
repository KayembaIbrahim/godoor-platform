"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Gift,
  Loader2,
  Smartphone,
  Wallet,
  Camera,
  ExternalLink,
  KeyRound,
  Send,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { useSession } from "@/lib/session-store";
import { uploadFile, apiAuthHeaders } from "@/lib/db";
import { MorseLogo } from "@/components/MorseLogo";

type LedgerEntry = {
  id: string;
  type: string;
  amountUgx: number;
  balanceAfter: number;
  status: string;
  reference: string;
  currency?: "UGX" | "USDT";
  network?: string;
  phone?: string;
  note?: string;
  createdAt: string;
};

type WalletData = {
  userId: string;
  availableUgx: number;
  availableUsdt: number;
  pendingUgx: number;
  pendingUsdt: number;
  currency: "UGX";
  ledger: LedgerEntry[];
};

type MorseConfig = {
  handle: string;
  network: string;
  referralCode: string;
  downloadUrl: string;
  rateUgx: number;
};

type ActiveTopup = {
  topupId: string;
  reference: string;
  amountUsdt: number;
  phone: string;
  handle: string;
  network: string;
  rateUgx: number;
  referralCode: string;
  downloadUrl: string;
  status: "awaiting_payment" | "pending_verification";
  instructions?: string;
  message?: string;
};

const QUICK_USD = [5, 10, 20, 50, 100];

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
}

export function WalletPanel() {
  const { supabaseUser, profile, setProfile } = useSession();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [cfg, setCfg] = useState<MorseConfig | null>(null);
  const [phone, setPhone] = useState("");
  const [amountUsdt, setAmountUsdt] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveTopup | null>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [payAmount, setPayAmount] = useState(2000);
  const [toast, setToast] = useState<string | null>(null);
  const [morseTag, setMorseTag] = useState(profile.morseTag ?? "");
  const [morseTagConfirm, setMorseTagConfirm] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagNote, setTagNote] = useState<string | null>(null);
  const [tagSaved, setTagSaved] = useState(false);
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeTag, setChangeTag] = useState("");
  const [changePhone, setChangePhone] = useState("");
  const [changeReason, setChangeReason] = useState("");

  const morseOk = /^[a-z0-9_]{3,32}$/i.test(morseTag.trim().replace(/^@/, ""));

  const load = useCallback(async () => {
    const res = await fetch("/api/wallet", { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json();
    if (res.ok) setWallet(json.data);
    const cfgRes = await fetch("/api/morse");
    const cfgJson = await cfgRes.json().catch(() => ({}));
    if (cfgJson.config) setCfg(cfgJson.config);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function gasBalanceUgx(): number {
    if (!wallet) return 0;
    const rate = cfg?.rateUgx || 3800;
    return wallet.availableUgx + wallet.availableUsdt * rate;
  }

  function usdtCost(ugx: number): number {
    const rate = cfg?.rateUgx || 3800;
    return Math.ceil(ugx / rate);
  }

  async function saveMorseTag() {
    setTagError(null);
    if (!morseOk) { setTagError("Morse usernames use letters, numbers or underscores (3–32)."); return; }
    setTagSaving(true);
    try {
      const res = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag: morseTag.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTagError(j?.error || "That morse tag could not be saved.");
        return;
      }
      setProfile({ morseTag: j?.tag || morseTag.trim() });
      setTagSaved(true);
      setToast("Morse wallet confirmed!");
      setTimeout(() => setToast(null), 3000);
    } catch {
      setTagError("Network error. Try again.");
    } finally {
      setTagSaving(false);
    }
  }

  async function requestTagChange() {
    setTagError(null);
    setTagNote(null);
    const t = changeTag.trim().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,32}$/i.test(t)) {
      setTagError("Morse usernames use letters, numbers or underscores (3–32).");
      return;
    }
    setTagSaving(true);
    try {
      const res = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag: t, contactPhone: changePhone.trim() || undefined, reason: changeReason.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setProfile({ morseTag: j?.tag || t });
        setTagSaved(true);
        setShowChangeForm(false);
        setChangeTag("");
        setChangePhone("");
        setChangeReason("");
        setToast("Morse tag confirmed!");
        setTimeout(() => setToast(null), 3000);
        return;
      }
      if (j?.locked) {
        setTagNote(j?.error || "Change request sent — our support team will contact you to approve it.");
        setShowChangeForm(false);
        setChangeTag("");
        setChangePhone("");
        setChangeReason("");
        return;
      }
      setTagError(j?.error || "That morse tag could not be saved.");
    } catch {
      setTagError("Network error. Try again.");
    } finally {
      setTagSaving(false);
    }
  }

  async function startTopup() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/topup", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ amountUsdt, phone: phone || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message || json.error || "Top-up failed";
        setError(typeof msg === "string" ? msg : "Top-up failed");
        setActive(null);
        return;
      }
      setActive(json.data);
      await load();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reportSent() {
    if (!active) return;
    setError(null);
    setBusy(true);
    try {
      let screenshotUrl: string | undefined;
      if (screenshot) {
        screenshotUrl = await uploadFile(
          screenshot,
          "topups",
          `topups/${supabaseUser?.id || "anon"}/${Date.now()}.${screenshot.name.split(".").pop() || "jpg"}`,
        );
        if (!screenshotUrl) setToast("Could not upload the screenshot yet — you can send it after.");
      }
      const res = await fetch("/api/topup", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ reference: active.reference, screenshotUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message || json.error || "Could not confirm";
        setError(typeof msg === "string" ? msg : "Could not confirm");
        return;
      }
      setActive(json.data);
      if (json.meta?.wallet) setWallet(json.meta.wallet);
      setToast("Reported — our team verifies the Morse transfer and credits your wallet.");
      setTimeout(() => setToast(null), 4000);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function payService() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pay", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ amountUgx: payAmount, note: "Payment from GoDoor gas fee" }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message || json.error || "Payment failed";
        setError(typeof msg === "string" ? msg : "Payment failed");
        return;
      }
      if (json.data?.wallet) setWallet(json.data.wallet);
      setToast(`Paid ${formatUgx(payAmount)} from your GoDoor gas fee`);
      setTimeout(() => setToast(null), 3000);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function ledgerLabel(e: LedgerEntry) {
    if (e.type === "topup") return e.currency === "USDT" ? "Morse top-up (USD)" : "Top-up";
    if (e.type === "topup_pending") return "Top-up pending";
    if (e.type === "payment") return e.currency === "USDT" ? "Gas fee (USD)" : "Gas fee";
    if (e.type === "bonus") return "Free service fee";
    return e.type;
  }

  function ledgerAmount(e: LedgerEntry) {
    const sign = e.amountUgx >= 0 ? "+" : "";
    if (e.currency === "USDT") return `${sign}$${e.amountUgx} USD`;
    return `${sign}${formatUgx(e.amountUgx)}`;
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-5">
      <section className="lg:col-span-3 space-y-6">
        {/* ── Balance: GoDoor Gas Fee ── */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted">GoDoor Gas Fee</p>
              <p className="mt-2 font-display text-4xl font-semibold tabular-nums tracking-tight">
                {wallet ? `$${wallet.availableUsdt} USD` : "—"}
              </p>
              <p className="mt-1 text-sm text-muted tabular-nums">
                ≈ {formatUgx(Math.floor(gasBalanceUgx()))} spendable
                {wallet && wallet.availableUgx > 0 && <> · incl. {formatUgx(wallet.availableUgx)} free credit</>}
              </p>
              {(wallet && (wallet.pendingUgx > 0 || wallet.pendingUsdt > 0)) && (
                <p className="mt-1 text-sm text-warning">
                  {wallet.pendingUsdt > 0 ? `$${wallet.pendingUsdt} USD ` : ""}
                  {(wallet.pendingUgx > 0 ? formatUgx(wallet.pendingUgx) : "")}
                  {" "}waiting for admin verification
                </p>
              )}
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/30 text-go-2">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
          <p className="mt-4 text-sm text-muted">
            Top up from your <strong className="text-white">Morse partner wallet</strong> to fund your GoDoor gas fee.
            New customers get <strong className="text-white">2,000 UGX free</strong> (promo{" "}
            <code className="rounded bg-elevated px-1.5 py-0.5 text-xs text-go">GONEW</code>) to cover service fees on first orders.
          </p>
          <p className="mt-2 text-xs text-dim">
            Morse USD is shown in your local currency in the app · 1 USD ≈ {formatUgx((cfg?.rateUgx || 3800))} covers that much gas fee
          </p>
        </div>

        {/* ── Confirm Morse wallet (compulsory, every role) ── */}
        {!profile.morseTag && (
          <div className="rounded-2xl border border-go/40 bg-elevated p-6">
            <div className="flex items-center gap-2 text-go-2">
              <MorseLogo markOnly className="h-5" />
              <h2 className="font-display text-lg font-semibold">Confirm your Morse wallet</h2>
            </div>
            <p className="mt-2 text-sm text-muted">
              Enter your unique Morse username. No two GoDoor accounts share one — a tag that already exists with
              another user is an invalid morse tag. It is confirmed once, so re-type it below. Changes go through support.
            </p>
            {!cfg && (
              <p className="mt-2 rounded-lg bg-primary/15 px-3 py-2 text-xs text-muted">
                Don&apos;t have Morse yet? Download the app, sign up with GoDoor&apos;s friend code{" "}
                <strong className="text-go">AsAp4f</strong>, then come back and confirm your handle.
              </p>
            )}
            <div className="mt-4 space-y-2">
              <input
                value={morseTag}
                onChange={(e) => { setMorseTag(e.target.value); setTagError(null); setTagSaved(false); }}
                placeholder="Your Morse username"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
              <input
                value={morseTagConfirm}
                onChange={(e) => { setMorseTagConfirm(e.target.value); setTagError(null); setTagSaved(false); }}
                placeholder="Type the same tag again to confirm"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
              <button
                type="button"
                disabled={tagSaving || !morseOk || morseTagConfirm.trim().replace(/^@/, "") !== morseTag.trim().replace(/^@/, "")}
                onClick={() => void saveMorseTag()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
              >
                {tagSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MorseLogo markOnly className="h-4" />}
                Confirm my Morse username
              </button>
            </div>
            {tagError && <p className="mt-2 text-sm text-danger">{tagError}</p>}
            {morseTag && !morseOk && <p className="mt-2 text-xs text-warning">Letters, numbers or underscores (3–32).</p>}
            {morseOk && morseTagConfirm.trim().replace(/^@/, "") !== morseTag.trim().replace(/^@/, "") && morseTagConfirm && <p className="mt-2 text-xs text-warning">Both fields must match.</p>}
          </div>
        )}

        {/* ── Fixed Morse tag (already confirmed): changes go through support ── */}
        {profile.morseTag && (
          <div className="rounded-2xl border border-border bg-elevated p-6">
            <div className="flex items-center gap-2 text-go-2">
              <MorseLogo markOnly className="h-5" />
              <h2 className="font-display text-lg font-semibold">Morse wallet</h2>
            </div>
            <p className="mt-2 text-sm text-muted">
              Fixed tag: <span className="font-mono font-semibold text-fg">@{profile.morseTag.replace(/^@/, "")}</span>.
              Your Morse tag is locked for safety — no two GoDoor accounts share one.
            </p>
            {!showChangeForm ? (
              <button
                type="button"
                onClick={() => setShowChangeForm(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-go/10 px-3 py-2 text-xs font-semibold text-go hover:bg-go/20 transition"
              >
                <KeyRound className="h-3.5 w-3.5" /> Need to change it? Request a change
              </button>
            ) : (
              <div className="mt-3 space-y-2.5">
                <p className="text-xs text-muted">
                  A change request goes to our support team — they contact you to approve it before it goes live.
                </p>
                <input
                  value={changeTag}
                  onChange={(e) => { setChangeTag(e.target.value); setTagError(null); setTagNote(null); }}
                  placeholder="New Morse username"
                  className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
                />
                <input
                  value={changePhone}
                  onChange={(e) => setChangePhone(e.target.value)}
                  placeholder="Phone so support can reach you (optional)"
                  className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
                />
                <input
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Reason for the change (optional)"
                  className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={tagSaving || !/^[a-z0-9_]{3,32}$/i.test(changeTag.trim().replace(/^@/, ""))}
                    onClick={() => void requestTagChange()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
                  >
                    {tagSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Submit change request
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowChangeForm(false); setTagError(null); setTagNote(null); }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-elevated px-4 py-2.5 text-sm font-semibold text-muted hover:bg-bg"
                  >
                    Cancel
                  </button>
                </div>
                {changeTag && !/^[a-z0-9_]{3,32}$/i.test(changeTag.trim().replace(/^@/, "")) && (
                  <p className="text-xs text-warning">Letters, numbers or underscores (3–32).</p>
                )}
              </div>
            )}
            {tagNote && (
              <p className="mt-3 rounded-xl bg-success/10 px-3 py-2 text-xs font-medium text-success">{tagNote}</p>
            )}
            {tagError && <p className="mt-3 text-sm text-danger">{tagError}</p>}
          </div>
        )}

        {/* ── Active top-up ── */}
        {active ? (
          <div className="rounded-2xl border border-go/40 bg-elevated p-6">
            <div className="flex items-center gap-2 text-go-2">
              <Smartphone className="h-5 w-5" />
              <h2 className="font-display text-lg font-semibold">
                {active.status === "awaiting_payment" ? "Send the money on Morse" : "Awaiting verification"}
              </h2>
            </div>

            {active.status === "awaiting_payment" ? (
              <>
                <p className="mt-2 text-sm text-muted">
                  Open the Morse app, top up your Morse wallet from mobile money, then send{" "}
                  <strong className="text-white">${active.amountUsdt} USD</strong> (Morse shows it as UGX) to{" "}
                  <strong className="text-white">{active.handle}</strong> with your reference in the note.
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                    <dt className="text-muted">Send to (Morse)</dt>
                    <dd className="font-medium">
                      {active.handle}
                      <button
                        type="button"
                        onClick={() => { copyToClipboard(active.handle); setToast("Morse handle copied"); setTimeout(() => setToast(null), 2000); }}
                        className="ml-2 rounded-md p-1 text-muted transition hover:bg-elevated hover:text-fg"
                        aria-label="Copy Morse handle"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                    <dt className="text-muted">Amount</dt>
                    <dd className="font-medium tabular-nums">${active.amountUsdt} USD</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-bg px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <dt className="text-muted">Your reference</dt>
                      <span className="font-mono text-xs font-semibold text-go">{active.reference}</span>
                      <button
                        type="button"
                        onClick={() => { copyToClipboard(active.reference); setToast("Reference copied"); setTimeout(() => setToast(null), 2000); }}
                        className="rounded-md p-1 text-muted transition hover:bg-elevated hover:text-fg"
                        aria-label="Copy reference"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </dl>
                {active.instructions && (
                  <p className="mt-4 rounded-lg bg-primary/15 px-3 py-2 text-xs text-muted">
                    {active.instructions}
                  </p>
                )}

                <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-bg px-3 py-2.5 text-sm">
                  {screenshot ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-xs text-fg truncate">{screenshot.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-go" onClick={() => setScreenshot(null)}>Remove</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4 text-muted" />
                      <span className="text-xs text-muted">Attach your send screenshot (optional but speeds up verification)</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
                  />
                </label>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reportSent()}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-go px-4 py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  I&apos;ve sent the money
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  {active.message || "We&apos;ve received your report. The GoDoor team verifies the Morse transfer and credits your wallet shortly."}
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">Amount</dt>
                    <dd className="font-medium tabular-nums">${active.amountUsdt} USD</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Reference</dt>
                    <dd className="font-mono text-xs">{active.reference}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Status</dt>
                    <dd className="text-warning font-medium">Pending admin verification</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reportSent()}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted hover:bg-panel disabled:opacity-50"
                >
                  Check status again
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-6">
            <div className="flex items-center gap-2">
              <MorseLogo markOnly className="h-5" />
              <h2 className="font-display text-lg font-semibold">Top up your gas fee</h2>
            </div>
            <p className="mt-2 text-sm text-muted">
              Send USD from your Morse wallet to {cfg?.handle || "@Godoor"} (Morse shows the amount as UGX). An admin
              verifies the transfer, then your gas-fee balance is credited.
            </p>

            <div className="mt-4">
              <span className="text-sm text-muted">Amount (USD)</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_USD.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmountUsdt(q)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium tabular-nums ${
                      amountUsdt === q ? "bg-go text-white" : "bg-panel text-muted hover:text-white"
                    }`}
                  >
                    ${q} USD
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={amountUsdt}
                onChange={(e) => setAmountUsdt(Number(e.target.value) || 0)}
                className="mt-3 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm tabular-nums outline-none ring-go focus:ring-2"
              />
              <p className="mt-1 text-xs text-dim">
                ≈ {formatUgx(amountUsdt * (cfg?.rateUgx || 3800))} in gas fee · min 1 USD
              </p>
            </div>

            <label className="mt-4 block text-sm">
              <span className="text-muted">Morse handle you&apos;ll send from (optional)</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. your_morse_handle"
                className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
            </label>

            {error && (
              <p className="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>
            )}

            <button
              type="button"
              disabled={busy || amountUsdt < 1}
              onClick={() => void startTopup()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownLeft className="h-4 w-4" />}
              Get reference · ${amountUsdt} USD
            </button>
          </div>
        )}

        {/* ── No Morse wallet yet → referral ── */}
        <div className="rounded-2xl border border-go/30 bg-go/10 p-6">
          <div className="flex items-center gap-2 text-go-2">
            <MorseLogo markOnly className="h-5" />
            <h2 className="font-display text-base font-semibold">Don&apos;t have a Morse wallet yet?</h2>
          </div>
          <p className="mt-2 text-sm text-muted">
            Download the Morse app (send &amp; receive money, top up from mobile money), and when you sign up use
            GoDoor&apos;s friend code <strong className="text-go">{cfg?.referralCode || "AsAp4f"}</strong> — that funds
            GoDoor&apos;s partnership, so more merchants and riders join near you.
          </p>
          <a
            href={cfg?.downloadUrl || "https://morsemoney.com/download"}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-go px-5 py-2.5 text-sm font-semibold text-white hover:bg-go-2"
          >
            <ExternalLink className="h-4 w-4" /> Download Morse
          </a>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">Pay with your gas fee</h2>
          <p className="mt-1 text-sm text-muted">
            Pay a service bill or an order from your GoDoor balance. The free 2,000 UGX credit is spent first, then
            Morse USD at {formatUgx((cfg?.rateUgx || 3800))} = 1 USD.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex-1 text-sm">
              <span className="text-muted">Amount (UGX)</span>
              <input
                type="number"
                min={500}
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm tabular-nums outline-none ring-go focus:ring-2"
              />
            </label>
            <button
              type="button"
              disabled={busy || !wallet || gasBalanceUgx() < payAmount}
              onClick={() => void payService()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-2 disabled:opacity-50"
            >
              <ArrowUpRight className="h-4 w-4" />
              Pay (≈ ${usdtCost(payAmount)} USD)
            </button>
          </div>
          <p className="mt-2 text-xs text-dim">
            Balance ≈ {formatUgx(Math.floor(gasBalanceUgx()))}
          </p>
          {error && !active && (
            <p className="mt-3 text-sm text-danger">{error}</p>
          )}
        </div>
      </section>

      <aside className="lg:col-span-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-semibold">Activity</h2>
          <ul className="mt-4 space-y-3">
            {!wallet?.ledger.length && (
              <li className="text-sm text-muted">No activity yet. New customers start with 2,000 UGX free.</li>
            )}
            {wallet?.ledger.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">
                    {ledgerLabel(e)}{" "}
                    {e.currency === "USDT" && <span className="rounded bg-elevated px-1 py-0.5 text-[9px] text-go font-semibold">USD</span>}
                    {e.type === "bonus" && <Gift className="ml-1 inline h-3 w-3 text-success" />}
                  </p>
                  <p className="text-xs text-muted">
                    {e.note || e.reference}
                    {e.status ? ` · ${e.status}` : ""}
                  </p>
                  <p className="text-xs text-dim">
                    {new Date(e.createdAt).toLocaleString("en-UG")}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    e.amountUgx >= 0 ? "text-success" : "text-white"
                  }`}
                >
                  {ledgerAmount(e)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-success px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}