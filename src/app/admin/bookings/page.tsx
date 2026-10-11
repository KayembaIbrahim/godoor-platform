"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, XCircle, Loader2, Users, Utensils, Sparkles } from "lucide-react";
import { Stat, Toggle, AdminError } from "@/components/admin/AdminControls";

/**
 * Table reservations: the book, plus the controls that govern it.
 *
 * Booking is a new money-adjacent flow, so it ships OFF. Turning it on, and
 * whether a deposit is held, are commercial decisions that should not need a
 * deploy — hence the controls here rather than constants in code.
 *
 * Cancelling releases the seats so the table can be rebooked; completing is
 * what the front of house does once the party has arrived.
 */

type Rec = {
  id: string;
  merchantId: string;
  merchantName: string;
  userName: string;
  userEmail: string;
  date: string;
  time: string;
  guests: number;
  depositUgx: number;
  status: "confirmed" | "cancelled" | "completed";
  note: string;
  createdAt: string;
};

type Config = {
  enabled: boolean;
  maxGuests: number;
  depositPerGuestUgx: number;
  advanceDays: number;
  minNoticeMinutes: number;
};

const FIELDS: { key: keyof Omit<Config, "enabled">; label: string; help: string }[] = [
  { key: "maxGuests", label: "Max guests", help: "Hard ceiling per booking" },
  { key: "depositPerGuestUgx", label: "Deposit per guest (UGX)", help: "0 = free reservation" },
  { key: "advanceDays", label: "Book ahead (days)", help: "How far forward a guest may book" },
  { key: "minNoticeMinutes", label: "Notice needed (min)", help: "Same-day bookings only" },
];

const STATUS_TONE: Record<Rec["status"], string> = {
  confirmed: "bg-go/10 text-go",
  cancelled: "bg-danger/10 text-danger",
  completed: "bg-success/10 text-success",
};

const fmt = (n: unknown) => `UGX ${Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US")}`;

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<Rec[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"live" | "all">("live");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      const b = await res.json().catch(() => null);
      if (!res.ok) {
        setError(b?.error || "Could not load reservations.");
        return;
      }
      setBookings(b.bookings || []);
      setConfig(b.config);
    } catch {
      setError("Network problem. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (patch: Partial<Record<string, unknown>>) => {
      setSaving(true);
      setError("");
      try {
        const res = await fetch("/api/admin/bookings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) {
          setError(b?.error || "Could not save those settings.");
          return;
        }
        setConfig(b.config);
      } catch {
        setError("Network problem. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const decide = useCallback(
    async (id: string, action: "cancel" | "complete") => {
      setBusy(id);
      setError("");
      try {
        const res = await fetch("/api/admin/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) {
          setError(b?.error || "Could not update that reservation.");
          return;
        }
        await load();
      } catch {
        setError("Network problem. Try again.");
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const live = useMemo(() => bookings.filter((b) => b.status === "confirmed"), [bookings]);
  const shown = filter === "live" ? live : bookings;
  const covers = live.reduce((n, b) => n + b.guests, 0);
  const deposits = live.reduce((n, b) => n + b.depositUgx, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <CalendarCheck className="h-5 w-5 text-go" />
          Table Booking
        </h1>
        <p className="mt-1 text-sm text-muted">
          Reservations guests make from the homepage. Cancelling frees the seats so the
          table can be rebooked.
        </p>
      </header>

      <AdminError message={error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Upcoming tables" value={String(live.length)} tone="text-go" />
        <Stat label="Covers booked" value={String(covers)} />
        <Stat label="Deposits held" value={fmt(deposits)} tone="text-success" />
        <Stat label="All time" value={String(bookings.length)} />
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Sparkles className="h-4 w-4 text-go" />
          Booking controls
        </h2>

        {config && (
          <div className="mt-4">
            <Toggle
              label="Table booking live"
              hint="Off hides the section from the homepage and refuses every booking"
              on={config.enabled}
              onChange={(v) => void save({ enabled: v })}
            />
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-xs font-semibold text-muted">
              {f.label}
              <input
                type="number"
                value={config ? String(config[f.key]) : ""}
                onChange={(e) => setConfig((c) => (c ? { ...c, [f.key]: Number(e.target.value) } : c))}
                onBlur={(e) => void save({ [f.key]: Number(e.target.value) })}
                className="num mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-go"
              />
              <span className="mt-1 block text-[10px] font-normal text-dim">{f.help}</span>
            </label>
          ))}
        </div>

        {saving && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">
            Reservations ({filter === "live" ? live.length : bookings.length})
          </h2>
          <div className="flex gap-2">
            {(["live", "all"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={`min-h-11 rounded-xl px-4 text-xs font-bold capitalize ${
                  filter === k ? "bg-go text-white" : "border border-border text-muted"
                }`}
              >
                {k === "live" ? "Upcoming" : "All"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading reservations…
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No reservations yet. Once booking is live, guests booking from the homepage
            will appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {shown.map((b) => (
              <div key={b.id} className="rounded-xl border border-border bg-bg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base font-bold">{b.merchantName}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {b.date} at <span className="num font-semibold text-fg">{b.time}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <Users className="h-3 w-3" />
                      {b.guests} {b.guests === 1 ? "guest" : "guests"}
                      {b.depositUgx > 0 && <span className="text-dim">· {fmt(b.depositUgx)} deposit</span>}
                    </p>
                    <p className="mt-1 truncate text-xs text-dim">
                      {b.userName} · {b.userEmail}
                    </p>
                    {b.note && (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
                        <Utensils className="mt-0.5 h-3 w-3 shrink-0" />
                        {b.note}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${STATUS_TONE[b.status]}`}>
                      {b.status}
                    </span>
                    {b.status === "confirmed" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy === b.id}
                          onClick={() => void decide(b.id, "complete")}
                          className="tap-44 relative inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold text-success disabled:opacity-50"
                        >
                          {busy === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Seated
                        </button>
                        <button
                          type="button"
                          disabled={busy === b.id}
                          onClick={() => void decide(b.id, "cancel")}
                          className="tap-44 relative inline-flex items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold text-danger disabled:opacity-50"
                        >
                          <XCircle className="h-3 w-3" />
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}