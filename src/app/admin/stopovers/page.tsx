"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, CheckCircle2, Undo2, ShieldQuestion } from "lucide-react";

/**
 * Admin review of rider-declared waiting time.
 *
 * A wait charge is only ever contested by the customer, so this is the one place
 * an operator can undo it. Refunding zeroes BOTH the charge and the accumulated
 * minutes — zeroing only the money would let the next re-quote recompute the
 * wait from the minutes and resurrect the charge that was just refunded.
 *
 * The rate controls sit here too. Waiting time is the most abuse-prone number
 * on the platform, so tuning it must not require a deploy.
 */

const fmt = (n: unknown) => `UGX ${Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US")}`;

/** Mirrors the kv dispute record returned by /api/admin/stopovers. */
type Dispute = {
  rideId: string;
  reason: string;
  note?: string;
  at: string;
  resolved: boolean;
  waived: boolean;
};

type Ride = Record<string, unknown>;
type WaitTotals = { minutes: number; chargeUgx: number };
type Rates = Record<string, number>;

const RATE_FIELDS: { key: string; label: string; help: string }[] = [
  { key: "wait_per_min_ugx", label: "Per minute (UGX)", help: "Charged after the free window" },
  { key: "wait_grace_min", label: "Free waiting (min)", help: "Free once per ride, not per stop" },
  { key: "stopover_max_session_min", label: "Max one stop (min)", help: "Caps a single event" },
  { key: "stopover_max_ride_min", label: "Max per trip (min)", help: "Caps the whole ride" },
  { key: "stopover_cooldown_min", label: "Cooldown (min)", help: "Gap before another stop" },
  { key: "evening_start_hour", label: "Evening starts (EAT)", help: "19.5 = 7:30pm" },
  { key: "evening_multiplier", label: "Evening uplift (×)", help: "1.0 = off. Re-prices live rides" },
  { key: "late_start_hour", label: "Late starts (EAT)", help: "22 = 10:00pm" },
  { key: "late_multiplier", label: "Late-night uplift (×)", help: "1.0 = off" },
];

export default function AdminStopovers() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [rates, setRates] = useState<Rates>({});
  const [totals, setTotals] = useState<Record<string, WaitTotals>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/stopovers", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setDisputes(d.disputes ?? []);
      setRides(d.rides ?? []);
      setTotals(d.totals ?? {});
      if (d.rates) setRates(d.rates as Rates);
    } catch {
      /* leave the last good render in place */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rideFor = (id: string) => rides.find((r) => r.id === id);
  const waitFor = (id: string) => totals[id] ?? { minutes: 0, chargeUgx: 0 };

  const resolve = async (id: string, outcome: "upheld" | "refunded") => {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/stopovers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "dispute", id, outcome }),
      });
      const body = await res.json().catch(() => ({}));
      setMsg(res.ok ? (outcome === "refunded" ? "Wait charge refunded." : "Charge upheld.") : body.error);
      await refresh();
    } catch {
      setMsg("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const saveRate = async (key: string, value: number) => {
    try {
      const res = await fetch("/api/admin/stopovers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "rates", rates: { [key]: value } }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.rates) {
        setRates(body.rates as Rates);
        setMsg(`${key} saved — in effect on the next quote.`);
      } else {
        setMsg(body.error || "Could not save.");
      }
    } catch {
      setMsg("Could not reach the server.");
    }
  };

  return (
    <div className="pb-24 md:pb-0 animate-fade-in">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold">Fares &amp; waiting</h1>
        {disputes.length > 0 && (
          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-bold text-warning">
            {disputes.length} to review
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        Review customer complaints about rider waiting time, and tune the fare rates, time-of-day
        tiers and stopover limits.
      </p>

      {msg ? (
        <p role="status" className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg">
          {msg}
        </p>
      ) : null}

      {/* ── Complaints ─────────────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
          <ShieldQuestion className="h-4 w-4" aria-hidden /> Customer complaints
        </h2>

        {disputes.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-success" aria-hidden />
            <p className="mt-2 text-sm font-medium">No open complaints</p>
            <p className="text-xs text-muted">Nothing to review right now.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {disputes.map((d) => {
              const ride = rideFor(d.rideId);
              const wait = waitFor(d.rideId);
              return (
                <li key={d.rideId} className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-fg">
                        {String(d.reason).replace(/_/g, " ")}
                      </p>
                      {d.note ? (
                        <p className="mt-1 text-xs italic text-muted">&ldquo;{d.note}&rdquo;</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted">
                        {new Date(d.at).toLocaleString()}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-warning/20 px-2.5 py-1 text-xs font-bold tabular-nums text-warning">
                      {fmt(wait.chargeUgx)}
                    </span>
                  </div>

                  {ride ? (
                    <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface/70 px-3 py-2.5 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-muted">Wait</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {Math.round(wait.minutes * 10) / 10} min
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Distance</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {Number(ride.distance_km) || 0} km
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Fare</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {fmt(ride.fare_ugx)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Trip total</dt>
                        <dd className="font-semibold tabular-nums text-fg">
                          {fmt(ride.total_ugx)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy === d.rideId}
                      onClick={() => void resolve(d.rideId, "refunded")}
                      className="btn bg-primary text-white hover:bg-primary-2 disabled:opacity-60"
                    >
                      <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {busy === d.rideId ? "Working…" : "Refund wait charge"}
                    </button>
                    <button
                      type="button"
                      disabled={busy === d.rideId}
                      onClick={() => void resolve(d.rideId, "upheld")}
                      className="btn bg-surface text-muted !border-border hover:bg-elevated disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Uphold charge
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Rate controls ──────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
          <Clock className="h-4 w-4" aria-hidden /> Rates &amp; limits
        </h2>
        <p className="mt-1 text-xs text-muted">
          Waiting is free for the grace window once per trip, then billed per minute.
          The rider must declare a stop and the customer is notified — nothing is
          charged automatically.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {RATE_FIELDS.map((f) => (
            <label
              key={f.key}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{f.label}</span>
                <span className="block text-[11px] text-muted">{f.help}</span>
              </span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                defaultValue={rates[f.key] ?? 0}
                onBlur={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n) && n !== rates[f.key]) void saveRate(f.key, n);
                }}
                aria-label={f.label}
                className="w-20 shrink-0 rounded-lg border border-border bg-elevated px-2 py-2 text-right text-sm font-semibold tabular-nums text-fg"
              />
            </label>
          ))}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
          <span>
            Raising the per-minute rate is the most visible way to lose riders and
            the easiest way to lose customers. The evening and late-night uplifts
            re-price every ride booked after those hours the moment you save them
            &mdash; they ship switched off at 1.0&times;. Change any of these deliberately.
          </span>
        </p>
      </section>
    </div>
  );
}
