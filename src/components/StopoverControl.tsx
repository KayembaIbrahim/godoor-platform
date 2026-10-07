"use client";

import { useState } from "react";
import {
  Clock,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  ChevronDown,
  X,
} from "lucide-react";
import { useRideStopover } from "@/lib/use-stopover";
import { startRideStopover, endRideStopover } from "@/lib/db";
import {
  STOPOVER_REASONS,
  STOPOVER_REASON_LABEL,
  formatDuration,
  type StopoverReason,
} from "@/lib/stopover-core";

const formatUgx = (n: number) => `UGX ${Math.max(0, Math.round(n)).toLocaleString("en-US")}`;

/**
 * Rider-facing stopover control.
 *
 * Deliberately explicit rather than automatic. The rider taps "I'm waiting",
 * picks why, and the CUSTOMER is told — because a rider who can quietly start a
 * meter is a rider who will, eventually, and the customer discovering a wait
 * charge at payment is how one bad trip becomes a deleted account.
 *
 * The confirmation step states the rate and that the passenger will be notified.
 * A rider who does not know they are charging the passenger should not be
 * allowed to charge the passenger by accident.
 */
export function StopoverControl({
  rideId,
  active,
  onChanged,
}: {
  rideId: string;
  /** Only true while the trip is in progress — a wait cannot exist otherwise. */
  active: boolean;
  onChanged?: () => void;
}) {
  const { view, ready, busy, error, run } = useRideStopover(rideId, active);
  const [picking, setPicking] = useState(false);

  /* No control at all while the feature is switched off server-side, rather
     than a button that answers "Waiting time is not enabled yet". */
  if (!active || ready === false) return null;

  /* ── Running: the big, unmissable state ─────────────────────────────────── */
  if (view?.open) {
    const graceLeft = view.grace_left_min;
    const inGrace = graceLeft > 0;
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20">
            <PauseCircle className="h-5 w-5 text-warning" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">
              Waiting on {view.reason_label?.toLowerCase() ?? "passenger"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {view.reason_hint ?? "Your passenger has been notified."}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between rounded-xl bg-surface/70 px-3 py-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Waiting
            </p>
            <p className="text-2xl font-bold tabular-nums text-fg">
              {formatDuration(view.elapsed_min * 60)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {inGrace ? "Free for" : "Added to fare"}
            </p>
            <p
              className={`text-2xl font-bold tabular-nums ${
                inGrace ? "text-success" : "text-warning"
              }`}
            >
              {inGrace ? formatDuration(graceLeft * 60) : formatUgx(view.accrued_ugx)}
            </p>
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-snug text-muted">
          {inGrace ? (
            <>
              Free waiting ends in {formatDuration(graceLeft * 60)}, then{" "}
              <span className="font-semibold text-fg">
                {formatUgx(view.rate_per_min_ugx)}/min
              </span>{" "}
              is added.
            </>
          ) : (
            <>
              Billing at{" "}
              <span className="font-semibold text-fg">
                {formatUgx(view.rate_per_min_ugx)}/min
              </span>
              . It stops the moment you start moving.
            </>
          )}
        </p>

        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => endRideStopover(rideId)).then((ok) => ok && onChanged?.())}
          className="btn mt-3 w-full bg-primary text-white hover:bg-primary-2 disabled:opacity-60"
        >
          <PlayCircle className="h-4 w-4 shrink-0" aria-hidden />
          {busy ? "Ending…" : "End wait & resume trip"}
        </button>
        {error ? (
          <p role="alert" className="mt-2 text-[11px] font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  /* ── Idle: the reason picker ────────────────────────────────────────────── */
  if (picking) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-fg">Why are you waiting?</p>
            <p className="mt-0.5 text-[11px] text-muted">
              Your passenger sees this reason immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPicking(false)}
            aria-label="Cancel"
            className="tap-44 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-elevated"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <ul className="mt-3 space-y-1.5">
          {STOPOVER_REASONS.map((reason: StopoverReason) => (
            <li key={reason}>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setPicking(false);
                  const ok = await run(() => startRideStopover(rideId, reason));
                  if (ok) onChanged?.();
                }}
                className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border bg-elevated px-3 py-2.5 text-left text-sm text-fg hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
              >
                {STOPOVER_REASON_LABEL[reason]}
                <ChevronDown className="h-4 w-4 -rotate-90 text-dim" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="mt-2 text-[11px] font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  /* ── Idle: the trigger ──────────────────────────────────────────────────── */
  const rate = view?.rate_per_min_ugx ?? 100;
  const grace = view?.grace_min ?? 3;

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => setPicking(true)}
        className="btn w-full bg-surface text-fg !border-border hover:border-warning/40 hover:bg-warning/10 disabled:opacity-60"
      >
        <PauseCircle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        {busy ? "Starting…" : "Waiting on passenger?"}
      </button>

      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-dim" aria-hidden />
        <span>
          {formatDuration(grace * 60)} free, then {formatUgx(rate)}/min is added to the
          passenger&rsquo;s fare. They are notified the moment you start.
        </span>
      </p>
    </div>
  );
}

/** Compact read-only pill for the rider's ride card — mirrors the customer's view. */
export function StopoverPill({
  rideId,
  active,
}: {
  rideId: string;
  active: boolean;
}) {
  const { view, ready } = useRideStopover(rideId, active);
  if (!active || ready === false || !view || (!view.open && view.total_wait_ugx <= 0)) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-warning">
      <Clock className="h-3 w-3" aria-hidden />
      {view.open ? `Waiting ${formatDuration(view.elapsed_min * 60)}` : "Wait charged"}{" "}
      {formatUgx(view.total_wait_ugx)}
    </span>
  );
}
