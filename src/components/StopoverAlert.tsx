"use client";

import { useState } from "react";
import { Clock, AlertTriangle, ShieldQuestion, X, CheckCircle2 } from "lucide-react";
import { useRideStopover } from "@/lib/use-stopover";
import { disputeRideStopover } from "@/lib/db";
import { formatDuration } from "@/lib/stopover-core";

const formatUgx = (n: number) => `UGX ${Math.max(0, Math.round(n)).toLocaleString("en-US")}`;

const DISPUTE_REASONS: { id: string; label: string }[] = [
  { id: "incorrect_wait", label: "I was ready and waiting" },
  { id: "rider_never_came", label: "My rider never arrived" },
  { id: "route_delayed", label: "The wait was not my fault" },
  { id: "overcharged", label: "The amount looks wrong" },
];

/**
 * The customer's stopover banner.
 *
 * This exists because the alternative is indefensible: the customer is charged
 * for waiting, so they get to see it happening, be told why, watch the exact
 * figure climb in the same units they will be billed, and contest it without
 * having to phone a support line.
 *
 * Everything shown here comes from the server's own arithmetic, ticked against
 * the server's clock — so the number on this banner and the number on the bill
 * cannot drift apart.
 */
export function StopoverAlert({
  rideId,
  active,
  onDisputed,
}: {
  rideId: string;
  active: boolean;
  onDisputed?: () => void;
}) {
  const { view, ready, busy, error, run } = useRideStopover(rideId, active);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState(false);

  if (!view || ready === false) return null;

  /* Nothing running and nothing charged: the banner has no job to do. Keeping
     it mounted but empty costs nothing and avoids a layout jump when a wait
     starts mid-ride. */
  if (!view.open && view.total_wait_ugx <= 0 && !view.disputed) return null;

  /* ── Dispute sheet ──────────────────────────────────────────────────────── */
  if (picking) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-fg">Report this wait charge</p>
            <p className="mt-0.5 text-[11px] text-muted">
              GoDoor Support reviews every report. The charge stays on your trip
              until it is looked at.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPicking(false)}
            aria-label="Close"
            className="tap-44 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-elevated"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <ul className="mt-3 space-y-1.5">
          {DISPUTE_REASONS.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setPicking(false);
                  const ok = await run(() => disputeRideStopover(rideId, r.id));
                  if (ok) {
                    setSent(true);
                    onDisputed?.();
                  }
                }}
                className="flex min-h-11 w-full items-center rounded-xl border border-border bg-elevated px-3 py-2.5 text-left text-sm text-fg hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /* ── Confirmed report ───────────────────────────────────────────────────── */
  if (view.disputed || sent) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/10 p-4" role="status">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-fg">Report sent</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">
              GoDoor Support will review this wait. You do not need to do anything
              else — we will update you here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Settled: a charge exists, nothing running ──────────────────────────── */
  if (!view.open) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-fg">Waiting time</p>
              <p className="mt-0.5 text-[11px] text-muted tabular-nums">
                {formatDuration(view.total_wait_min * 60)} ·{" "}
                <span className="font-semibold text-fg">
                  {formatUgx(view.total_wait_ugx)}
                </span>{" "}
                added to your fare
              </p>
            </div>
          </div>
          {!view.waived ? (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted hover:border-danger/40 hover:text-danger"
            >
              Dispute
            </button>
          ) : null}
        </div>
        {view.waived ? (
          <p className="mt-2 text-[11px] font-medium text-success">
            Waived by GoDoor — nothing has been charged.
          </p>
        ) : null}
      </div>
    );
  }

  /* ── Running ────────────────────────────────────────────────────────────── */
  const inGrace = view.grace_left_min > 0;
  return (
    <div
      className="rounded-2xl border border-warning/40 bg-warning/10 p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/20">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
            {view.reason_label ?? "Your rider is waiting"}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            {view.reason_hint ?? "Your rider has stopped and is holding for you."}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between rounded-xl bg-surface/70 px-3 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Waiting
          </p>
          <p className="text-xl font-bold tabular-nums text-fg">
            {formatDuration(view.elapsed_min * 60)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {inGrace ? "Free for" : "Added so far"}
          </p>
          <p
            className={`text-xl font-bold tabular-nums ${
              inGrace ? "text-success" : "text-warning"
            }`}
          >
            {inGrace ? formatDuration(view.grace_left_min * 60) : formatUgx(view.accrued_ugx)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-muted">
        {inGrace ? (
          <>
            Waiting is free for the first{" "}
            <span className="font-semibold text-fg">
              {formatDuration(view.grace_min * 60)}
            </span>
            , then{" "}
            <span className="font-semibold text-fg">
              {formatUgx(view.rate_per_min_ugx)}/min
            </span>{" "}
            is added to your fare.
          </>
        ) : (
          <>
            Billing at{" "}
            <span className="font-semibold text-fg">
              {formatUgx(view.rate_per_min_ugx)}/min
            </span>
            . This stops automatically when your rider sets off.
          </>
        )}
      </p>

      <button
        type="button"
        onClick={() => setPicking(true)}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-[12px] font-semibold text-muted hover:border-danger/40 hover:text-danger"
      >
        <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
        This looks wrong
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
