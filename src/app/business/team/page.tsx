"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users, Truck, ShieldCheck, ArrowLeft, Plus, X, Check, Phone,
  Mail, MapPin, Navigation, RefreshCw, Radio, Star, Clock, AlertTriangle
} from "lucide-react";
import { useSession } from "@/lib/session-store";
import {
  fetchBusinessRiders, inviteBusinessRider, updateBusinessRider,
  type StoreRiderMember, apiAuthHeaders
} from "@/lib/db";

const MEMBER_STATUS: Record<string, { label: string; cls: string }> = {
  invited: { label: "Invited", cls: "bg-warning/15 text-warning" },
  active: { label: "Active", cls: "bg-success/15 text-success" },
  declined: { label: "Declined", cls: "bg-danger/15 text-danger" },
  removed: { label: "Removed", cls: "bg-elevated text-muted" },
};

function riderOnlineCls(r: StoreRiderMember): string {
  if (!r.rider.online) return "bg-elevated text-muted";
  if (r.on_delivery) return "bg-primary/15 text-primary";
  return "bg-success/15 text-success";
}

export default function BusinessTeam() {
  const { onboarded, role, profile } = useSession();
  const [mounted, setMounted] = useState(false);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [riders, setRiders] = useState<StoreRiderMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteValue, setInviteValue] = useState("");
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [rateEditor, setRateEditor] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    try {
      const uid = useSession.getState().supabaseUser?.id || "";
      if (!uid) return;
      let mid = merchantId;
      if (!mid) {
        const res = await fetch(`/api/business/me`, { cache: "no-store", headers: await apiAuthHeaders(false) });
        const json = await res.json();
        mid = json.merchant?.id || null;
        if (mid) setMerchantId(mid);
      }
      if (mid) {
        const fleet = await fetchBusinessRiders(mid);
        setRiders(fleet);
      }
    } catch (e) {
      console.error("[GoDoor] team refresh error:", e);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!mounted) return;
    let attempts = 0;
    const retry = () => {
      attempts++;
      if (useSession.getState().supabaseUser?.id || attempts >= 10) {
        refresh();
      } else {
        setTimeout(retry, 300);
      }
    };
    retry();
  }, [mounted, refresh]);

  useEffect(() => {
    if (!mounted) return;
    const tick = () => refresh().catch(() => {});
    const poll = setInterval(tick, 15000);
    const onFocus = () => { if (document.visibilityState === "visible") tick(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [mounted, refresh]);

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-3 text-sm text-muted">Loading team…</p>
        </div>
      </div>
    );
  }

  if (!onboarded || role !== "business") {
    return (
      <div className="hero-wash flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 ring-1 ring-primary/30">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-bold">Your Delivery Team</h1>
          <p className="mt-2 max-w-sm mx-auto text-sm text-muted">Register your business to build a courier fleet.</p>
          <Link href="/onboarding/business" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition">
            Register Business →
          </Link>
        </div>
      </div>
    );
  }

  const activeCount = riders.filter((r) => r.status === "active").length;
  const invitedCount = riders.filter((r) => r.status === "invited").length;

  const sendInvite = async () => {
    const v = inviteValue.trim();
    if (!v || !merchantId) return;
    setBusy(true);
    setInviteErr(null);
    try {
      const r = await inviteBusinessRider(merchantId, v);
      setInviteValue("");
      setInviteOpen(false);
      await refresh();
      setActionErr(null);
    } catch (e: any) {
      setInviteErr(e?.message || "Could not invite rider.");
    } finally {
      setBusy(false);
    }
  };

  const doAction = async (riderId: string, action: "remove" | "reinvite", name: string) => {
    if (!merchantId) return;
    setActionErr(null);
    const ok = await updateBusinessRider(merchantId, riderId, action);
    if (!ok) { setActionErr(`Failed to ${action} ${name}. Try again.`); return; }
    await refresh();
  };

  const saveRate = async (riderId: string) => {
    if (!merchantId) return;
    setActionErr(null);
    const n = Number(rateValue);
    if (!Number.isFinite(n) || n < 0) { setActionErr("Enter a valid rate."); return; }
    const ok = await updateBusinessRider(merchantId, riderId, "rate", Math.round(n));
    if (!ok) { setActionErr("Failed to save rate. Try again."); return; }
    setRateEditor(null);
    setRateValue("");
    await refresh();
  };

  const toggleRateEditor = (riderId: string, current: number) => {
    if (rateEditor === riderId) { setRateEditor(null); return; }
    setRateEditor(riderId);
    setRateValue(String(current || ""));
  };

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-bg px-0 pb-24 overflow-x-hidden">
      <div className="border-b border-primary/15 bg-gradient-to-b from-primary/8 to-transparent px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/business" className="mb-2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline">
              <ArrowLeft className="h-3 w-3" /> Back to dashboard
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-bold">Team</h1>
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                <Users className="h-2.5 w-2.5" /> {activeCount} active
              </span>
              {invitedCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold text-warning">
                  <Clock className="h-2.5 w-2.5" /> {invitedCount} pending
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-muted">Your own couriers — they only see {profile.businessName || "your store"}&apos;s orders</p>
          </div>
          <button type="button" onClick={() => { setInviteOpen((v) => !v); setInviteErr(null); }}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-primary/90 transition">
            <Plus className="h-3.5 w-3.5" /> Invite rider
          </button>
        </div>

        {inviteOpen && (
          <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Truck className="h-4 w-4 text-primary" /> Invite a rider to your fleet
            </h3>
            <p className="mt-1 text-[11px] text-muted">
              Enter the rider&apos;s registered phone number or email. They must have a GoDoor rider account (verified) — they&apos;ll get the invite in the rider app and accept it there.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={inviteValue}
                onChange={(e) => { setInviteValue(e.target.value); setInviteErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") sendInvite(); }}
                placeholder="e.g. 256700123456 or rider@email.com"
                className="flex-1 rounded-xl border border-border bg-bg px-3.5 py-2.5 text-sm outline-none focus:border-primary/50"
              />
              <div className="flex gap-2">
                <button type="button" disabled={busy && !inviteValue}
                  onClick={sendInvite}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-primary/90 transition disabled:opacity-60">
                  {busy ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Sending…</>) : (<>Send invite</>)}
                </button>
                <button type="button" onClick={() => { setInviteOpen(false); setInviteErr(null); }}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-border text-muted hover:bg-elevated transition">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {inviteErr && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {inviteErr}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4 px-4 pt-4">
        {actionErr && (
          <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
            <p className="text-xs text-danger">{actionErr}</p>
          </div>
        )}

        {/* Fleet intro */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Truck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">How it works</p>
              <p className="mt-0.5 text-[11px] text-muted">
                Riders in your fleet see only your store&apos;s open orders on their dispatch board — no more competing with the whole platform.
                When you accept their invite, payments still go via GoDoor. One rider can only be active with one store at a time.
              </p>
            </div>
          </div>
        </div>

        {/* Invite-first state */}
        {riders.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-dim" />
            <p className="mt-2 text-sm font-medium">No riders on your team yet</p>
            <p className="mt-1 text-xs text-muted max-w-sm mx-auto">Invite your delivery guys — they&apos;ll see your orders first when they go online in the rider app.</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-28 w-full rounded-2xl" />)}</div>
        ) : (
          riders.map((r) => (
            <div key={r.rider_id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/15 ring-1 ring-primary/30">
                    <span className="text-sm font-bold text-primary">{r.rider.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold">{r.rider.name}</p>
                      <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${MEMBER_STATUS[r.status]?.cls || "bg-elevated text-muted"}`}>
                        {MEMBER_STATUS[r.status]?.label || r.status}
                      </span>
                      {r.rider.verified && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">
                          <ShieldCheck className="h-2.5 w-2.5" /> Verified
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      {r.rider.phone && (
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {r.rider.phone}</span>
                      )}
                      {r.rider.email && (
                        <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" /> {r.rider.email}</span>
                      )}
                      <span className="flex items-center gap-1 capitalize"><Truck className="h-3 w-3" /> {r.rider.vehicle_type}</span>
                      {r.rider.rating > 0 && (
                        <span className="flex items-center gap-1"><Star className="h-3 w-3 text-warning" /> {r.rider.rating.toFixed(1)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${riderOnlineCls(r)}`}>
                  <Radio className={`h-2.5 w-2.5 ${r.rider.online ? "animate-pulse" : ""}`} />
                  {r.on_delivery ? "On delivery" : r.rider.online ? "Online" : "Offline"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {r.rate_ugx > 0 && (
                  <span className="flex items-center gap-1.5 rounded-xl bg-bg px-3 py-1.5 text-[11px] font-medium text-muted">
                    <Navigation className="h-3 w-3 text-primary" /> Rate: <span className="font-bold text-fg tabular-nums">UGX {r.rate_ugx.toLocaleString()}</span>
                  </span>
                )}
                <span className="flex items-center gap-1.5 rounded-xl bg-bg px-3 py-1.5 text-[11px] text-dim">
                  <MapPin className="h-3 w-3" /> Joined {new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>

                <div className="ml-auto flex flex-wrap gap-2">
                  <button type="button" onClick={() => toggleRateEditor(r.rider_id, r.rate_ugx)}
                    className="flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-2 text-[11px] font-medium text-muted hover:bg-elevated transition">
                    <Plus className="h-3 w-3" /> {r.rate_ugx > 0 ? "Edit rate" : "Add drop rate"}
                  </button>
                  {r.status === "removed" || r.status === "declined" ? (
                    <button type="button" disabled={busy}
                      onClick={() => doAction(r.rider_id, "reinvite", r.rider.name)}
                      className="flex items-center gap-1 rounded-xl bg-primary/15 px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/25 transition disabled:opacity-60">
                      <RefreshCw className="h-3 w-3" /> Reinvite
                    </button>
                  ) : r.status === "active" ? (
                    <button type="button" disabled={busy}
                      onClick={() => { if (confirm(`Remove ${r.rider.name} from your team? They'll keep any deliveries already in progress.`)) doAction(r.rider_id, "remove", r.rider.name); }}
                      className="flex items-center gap-1 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] font-semibold text-danger hover:bg-danger/20 transition disabled:opacity-60">
                      <X className="h-3 w-3" /> Remove
                    </button>
                  ) : (
                    <button type="button" disabled={busy}
                      onClick={() => { if (confirm(`Withdraw the invite for ${r.rider.name}?`)) doAction(r.rider_id, "remove", r.rider.name); }}
                      className="flex items-center gap-1 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] font-semibold text-danger hover:bg-danger/20 transition disabled:opacity-60">
                      <X className="h-3 w-3" /> Cancel invite
                    </button>
                  )}
                </div>
              </div>

              {rateEditor === r.rider_id && (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-bg p-3 sm:flex-row sm:items-center">
                  <p className="text-[11px] text-muted">Per-drop pay for this rider (UGX):</p>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={rateValue}
                    onChange={(e) => { setRateValue(e.target.value); setActionErr(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRate(r.rider_id); }}
                    placeholder="e.g. 3000"
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary/50"
                  />
                  <div className="flex gap-2">
                    <button type="button" disabled={busy}
                      onClick={() => saveRate(r.rider_id)}
                      className="flex items-center justify-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition disabled:opacity-60">
                      <Check className="h-3 w-3" /> Save
                    </button>
                    <button type="button" onClick={() => setRateEditor(null)}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:bg-elevated transition">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        <p className="pb-2 text-center text-[10px] text-dim">
          Invites appear instantly in the rider&apos;s GoDoor app — they accept there before they can see your orders.
        </p>
      </div>
    </div>
  );
}