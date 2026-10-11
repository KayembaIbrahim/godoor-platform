"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Zap, Clock, ArrowRight } from "lucide-react";
import { addDays, kampalaDate } from "@/lib/booking";

/**
 * "When should it arrive?"
 *
 * Two honest choices and nothing more: ASAP, or a scheduled slot. Both hand a
 * real parameter to checkout rather than pretending to reserve capacity —
 * GoDoor does not hold a rider for a chosen hour, and pretending otherwise
 * would set an expectation the platform cannot meet.
 */

const DAYS = 7;

function dayList(from: string) {
  return Array.from({ length: DAYS }, (_, i) => {
    const iso = addDays(from, i);
    const d = new Date(`${iso}T00:00:00Z`);
    return {
      iso,
      weekday: i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    };
  });
}

/** Bookable windows on any given evening. */
const WINDOWS = ["12:00 – 14:00", "17:00 – 19:00", "19:00 – 21:00"];

export default function DeliveryPreference() {
  const today = kampalaDate();
  const days = useMemo(() => dayList(today), [today]);
  const [mode, setMode] = useState<"asap" | "scheduled">("asap");
  const [day, setDay] = useState(today);
  const [window, setWindow] = useState(WINDOWS[1]);

  const href =
    mode === "asap"
      ? "/browse/food"
      : `/browse/food?when=${encodeURIComponent(`${day} ${window}`)}`;

  return (
    <section id="delivery" className="border-b border-border py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <CalendarClock className="h-5 w-5 text-go" />
          Delivery preference
        </h2>
        <p className="mt-1 text-sm text-muted">
          Pick when you want it. You can always change this before you pay.
        </p>

        {/* Mode */}
        <div className="mt-5 flex flex-wrap gap-2">
          {(
            [
              { key: "asap", label: "As soon as possible", Icon: Zap },
              { key: "scheduled", label: "Schedule for later", Icon: Clock },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                mode === key
                  ? "bg-go text-white shadow-glow"
                  : "border border-border bg-surface text-muted hover:text-fg"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {mode === "scheduled" && (
          <div className="mt-5 space-y-4">
            {/* Days */}
            <div className="flex snap-x gap-2 overflow-x-auto pb-1">
              {days.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setDay(d.iso)}
                  aria-pressed={day === d.iso}
                  className={`min-h-11 shrink-0 snap-start rounded-xl border px-4 py-2 text-left transition ${
                    day === d.iso
                      ? "border-go bg-go/10"
                      : "border-border bg-surface hover:border-go/40"
                  }`}
                >
                  <span className="block text-xs font-bold">{d.weekday}</span>
                  <span className="block text-[10px] text-muted">{d.day}</span>
                </button>
              ))}
            </div>

            {/* Windows */}
            <div className="flex flex-wrap gap-2">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindow(w)}
                  aria-pressed={window === w}
                  className={`num min-h-11 rounded-xl border px-4 text-xs font-bold transition ${
                    window === w
                      ? "border-go bg-go/10 text-go"
                      : "border-border bg-surface text-muted hover:border-go/40"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}

        <Link
          href={href}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-bold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.98]"
        >
          {mode === "asap" ? "Browse food now" : `Continue with ${day === today ? "today" : days.find((d) => d.iso === day)?.weekday} ${window}`}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}