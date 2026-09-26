"use client";

import { useState, useEffect } from "react";
import {
  Settings, Save, DollarSign, Percent, Truck, Shield,
  TrendingUp, AlertTriangle, CheckCircle2, Loader2, KeyRound, LogOut
} from "lucide-react";
import { useRouter } from "next/navigation";
import { fetchFeeConfig, updateFeeConfig, type FeeConfig } from "@/lib/db";
import { formatUgx } from "@/lib/utils";
import { evaluatePassword } from "@/lib/password-strength";
import AdminTwoFactor from "@/components/AdminTwoFactor";

const STRENGTH_COLORS = ["bg-danger", "bg-red-500", "bg-warning", "bg-success/70", "bg-success", "bg-go"];
const STRENGTH_LABELS = ["", "Very weak", "Weak", "Fair", "Good", "Strong"];

export default function AdminSettings() {
  const [fees, setFees] = useState<FeeConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usingDefaultPw, setUsingDefaultPw] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchFeeConfig().then((f) => { setFees(f); setLoading(false); });
  }, []);

  useEffect(() => {
    fetch("/api/admin/auth", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.usingDefaultPassword) setUsingDefaultPw(true); })
      .catch(() => {});
  }, []);

  const update = (key: keyof FeeConfig, value: number) => {
    if (!fees) return;
    setFees({ ...fees, [key]: value });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!fees) return;
    setSaving(true);
    await updateFeeConfig(fees);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleChangePassword = async () => {
    if (pwNew !== pwConfirm) {
      setPwMsg({ ok: false, text: "New password and confirmation do not match." });
      return;
    }
    const strength = evaluatePassword(pwNew);
    if (!strength.ok) {
      setPwMsg({ ok: false, text: "Password is not strong enough. Meet all the requirements below." });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPwMsg({ ok: true, text: "Password updated successfully. Use it next time you sign in." });
        setPwCurrent(""); setPwNew(""); setPwConfirm(""); setUsingDefaultPw(false);
      } else {
        setPwMsg({ ok: false, text: data.error || "Could not update the password." });
      }
    } catch {
      setPwMsg({ ok: false, text: "Could not reach the server. Try again." });
    } finally {
      setPwBusy(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" }).catch(() => {});
    // Reload the current (secret) URL — it lands back on the login gate.
    window.location.reload();
  };

  const pwStrength = evaluatePassword(pwNew);
  const pwScore = pwStrength.score;
  const pwBtnDisabled = pwBusy || !pwCurrent || !pwStrength.ok || pwNew !== pwConfirm;

  if (loading || !fees) {
    return <div className="py-12 text-center text-muted">Loading settings…</div>;
  }

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Fees & Settings</h1>
          <p className="mt-1 text-sm text-muted">Configure platform fees, commissions, and delivery settings.</p>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
        </button>
      </div>

      {/* Service Fees */}
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-go/10"><DollarSign className="h-4 w-4 text-go" /></div>
          <div>
            <h2 className="text-sm font-semibold">Service Fees</h2>
            <p className="text-[10px] text-muted">Charged per order as platform commission</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-muted">Service Fee (%)</label>
            <div className="relative mt-1.5">
              <input type="number" value={fees.service_fee_percent} onChange={(e) => update("service_fee_percent", Number(e.target.value))}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 pr-8 text-sm outline-none ring-go focus:ring-2" />
              <Percent className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Min Service Fee</label>
            <input type="number" value={fees.service_fee_min_ugx} onChange={(e) => update("service_fee_min_ugx", Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Max Service Fee</label>
            <input type="number" value={fees.service_fee_max_ugx} onChange={(e) => update("service_fee_max_ugx", Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          </div>
        </div>
      </div>

      {/* Delivery Fees */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10"><Truck className="h-4 w-4 text-primary" /></div>
          <div>
            <h2 className="text-sm font-semibold">Delivery Fees</h2>
            <p className="text-[10px] text-muted">Default delivery fee and free delivery threshold</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-muted">Default Delivery Fee (UGX)</label>
            <input type="number" value={fees.delivery_fee_ugx} onChange={(e) => update("delivery_fee_ugx", Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Free Delivery Over (UGX)</label>
            <input type="number" value={fees.free_delivery_threshold_ugx} onChange={(e) => update("free_delivery_threshold_ugx", Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Minimum Order (UGX)</label>
            <input type="number" value={fees.min_order_ugx} onChange={(e) => update("min_order_ugx", Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          </div>
        </div>
      </div>

      {/* Commissions */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10"><TrendingUp className="h-4 w-4 text-primary" /></div>
          <div>
            <h2 className="text-sm font-semibold">Revenue Split</h2>
            <p className="text-[10px] text-muted">How delivery fees are split between rider and platform</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted">Rider Commission (%)</label>
            <div className="mt-1.5 flex items-center gap-2">
              <input type="range" min={0} max={100} value={fees.rider_commission_percent}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update("rider_commission_percent", v);
                  update("platform_commission_percent", 100 - v);
                }}
                className="flex-1 accent-go" />
              <span className="w-12 text-right text-sm font-bold text-go">{fees.rider_commission_percent}%</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Platform Commission (%)</label>
            <div className="mt-1.5 flex items-center gap-2">
              <input type="range" min={0} max={100} value={fees.platform_commission_percent}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update("platform_commission_percent", v);
                  update("rider_commission_percent", 100 - v);
                }}
                className="flex-1 accent-primary" />
              <span className="w-12 text-right text-sm font-bold text-primary">{fees.platform_commission_percent}%</span>
            </div>
          </div>
        </div>
        {/* Preview */}
        <div className="mt-4 rounded-xl bg-bg p-3">
          <p className="text-[10px] text-dim uppercase tracking-wider font-medium mb-2">Revenue Preview (per 2,000 UGX delivery fee)</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-surface p-2.5">
              <p className="text-[10px] text-muted">Rider earns</p>
              <p className="text-sm font-bold text-success">{formatUgx(2000 * fees.rider_commission_percent / 100)}</p>
            </div>
            <div className="rounded-lg bg-surface p-2.5">
              <p className="text-[10px] text-muted">Platform keeps</p>
              <p className="text-sm font-bold text-primary">{formatUgx(2000 * fees.platform_commission_percent / 100)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Info */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-success/10"><Shield className="h-4 w-4 text-success" /></div>
          <div>
            <h2 className="text-sm font-semibold">Platform Info</h2>
            <p className="text-[10px] text-muted">GoDoor platform configuration</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
            <span className="text-xs text-muted">Platform</span>
            <span className="text-xs font-semibold text-fg">GoDoor · Uganda</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
            <span className="text-xs text-muted">Payment Methods</span>
            <span className="text-xs font-semibold text-fg">MTN MoMo, Airtel Money, Cash</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
            <span className="text-xs text-muted">Wallet System</span>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-warning">
              <AlertTriangle className="h-3 w-3" /> Coming soon
            </span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-bg px-4 py-3">
            <span className="text-xs text-muted">Version</span>
            <span className="text-xs font-semibold text-fg">v1.0.0</span>
          </div>
        </div>
      </div>
    
      {/* Admin Security */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-go/10"><KeyRound className="h-4 w-4 text-go" /></div>
          <div>
            <h2 className="text-sm font-semibold">Admin Security</h2>
            <p className="text-[10px] text-muted">Change the admin portal password anytime</p>
          </div>
        </div>
        {usingDefaultPw && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold text-warning">You are using the default admin password</p>
              <p className="mt-0.5 text-muted">It is publicly known. Set a strong password below before going live.</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-muted">Current password</label>
            <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoComplete="current-password"
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">New password</label>
            <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} autoComplete="new-password"
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
            {pwNew.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition ${i < pwScore ? STRENGTH_COLORS[pwScore] : "bg-border"}`} />
                    ))}
                  </div>
                  <span className="text-[10px] font-semibold text-muted">{STRENGTH_LABELS[pwScore]}</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {pwStrength.requirements.map((r) => (
                    <li key={r.id} className={`flex items-center gap-1.5 text-[10px] ${r.met ? "text-success" : "text-muted"}`}>
                      <CheckCircle2 className={`h-3 w-3 ${r.met ? "text-success" : "text-dim"}`} />
                      {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Confirm new password</label>
            <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} autoComplete="new-password"
              className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
            {pwConfirm.length > 0 && pwNew !== pwConfirm && (
              <p className="mt-2 text-[10px] text-danger">Passwords do not match</p>
            )}
          </div>
        </div>
        {pwMsg && (
          <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${pwMsg.ok ? "border-success/25 bg-success/10 text-success" : "border-danger/25 bg-danger/10 text-danger"}`}>
            {pwMsg.text}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleChangePassword} disabled={pwBtnDisabled}
            className="flex items-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
            {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {pwBusy ? "Updating…" : "Update password"}
          </button>
          <button type="button" onClick={handleLogout}
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted hover:text-fg hover:border-danger/40 transition">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>

      <AdminTwoFactor />
    </div>
  );
}