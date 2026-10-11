"use client";

/**
 * Small primitives shared by the admin console screens.
 *
 * These were previously copy-pasted per page, which meant a fix to the tap
 * target or the toggle's ARIA state only reached one screen. One copy now.
 */

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-dim">{label}</p>
      <p className={`num mt-1 font-display text-lg font-bold ${tone ?? "text-fg"}`}>{value}</p>
    </div>
  );
}

export function Toggle({
  label, hint, on, onChange,
}: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-11 items-start gap-2 text-left"
    >
      <span
        className={`mt-0.5 grid h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition ${on ? "bg-go" : "bg-border"}`}
      >
        <span className={`h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-xs font-bold text-fg">{label}</span>
        <span className="block text-[10px] text-dim">{hint}</span>
      </span>
    </button>
  );
}

/** Standard admin error banner. One message, one obvious retry path. */
export function AdminError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
      {message}
    </p>
  );
}