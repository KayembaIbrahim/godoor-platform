"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck, Star, Users, MapPin, Loader2, Check, X, Sparkles, Clock,
} from "lucide-react";
import { addDays, kampalaDate, type BookingRecord } from "@/lib/booking";
import { useSession } from "@/lib/session-store";

/**
 * "Book a Table" — the new reservation flow.
 *
 * Two steps on purpose: pick a restaurant and a slot, confirm. A long form is
 * the thing the brief asked us to avoid ("minimise unnecessary forms"), and
 * everything that can be derived — today's date, the notice cut-off, which
 * slots are full — is derived server-side so the browser cannot disagree with
 * the book.
 *
 * Booking ships switched off in the admin console. When it is off the section
 * hides itself and the API refuses, so a half-built feature is never visible
 * to a guest mid-launch.
 */

type Merchant = {
  id: string;
  name: string;
  category: string | null;
  rating: number | null;
  district: string | null;
  tagline: string | null;
  opens_at: string | null;
  closes_at: string | null;
  logo_url: string | null;
  shop_photo_url: string | null;
};

type SlotsResponse = {
  date: string;
  slots: string[];
  seatsTaken: Record<string, number>;
  capacity: number;
  depositPerGuestUgx: number;
};

const CUISINES = ["All", "Food & Restaurants"];
const GUESTS = [1, 2, 3, 4, 5, 6, 8, 10];

export default function TableBooking() {
  const session = useSession();
  const today = kampalaDate();
  const [hidden, setHidden] = useState(true);

  const [shops, setShops] = useState<Merchant[]>([]);
  const [cuisine, setCuisine] = useState("All");
  const [party, setParty] = useState(2);
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<string[]>([]);
  const [seatsTaken, setSeatsTaken] = useState<Record<string, number>>({});
  const [capacity, setCapacity] = useState(20);
  const [depositPerGuest, setDepositPerGuest] = useState(0);

  const [active, setActive] = useState<Merchant | null>(null);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ reference: string; record: BookingRecord } | null>(null);

  /* ---- Restaurants to book ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/merchants", { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (!alive) return;
        const list: Merchant[] = Array.isArray(j?.merchants) ? j.merchants : [];
        setShops(list.filter((m) => /food|restaurant|kitchen/i.test(m.category || "")));
      } catch {
        /* leave the shelf empty rather than fake it */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---- Is booking switched on? ----
     The API is the authority: a 503 means the operator has not enabled it,
     so the section hides rather than showing a button that refuses. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/bookings?date=" + today, { cache: "no-store" });
        if (!alive) return;
        setHidden(res.status === 503 || !res.ok);
      } catch {
        if (alive) setHidden(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [today]);

  const filtered = useMemo(
    () => (cuisine === "All" ? shops : shops.filter((s) => s.category === cuisine)),
    [shops, cuisine],
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(today, i);
      const d = new Date(`${iso}T00:00:00Z`);
      return {
        iso,
        label: i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
        num: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      };
    }),
    [today],
  );

  /* ---- Slots for the chosen restaurant ---- */
  const loadSlots = useCallback(
    async (merchantId: string, date: string) => {
      try {
        const res = await fetch(`/api/bookings?merchant_id=${merchantId}&date=${date}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setSlots([]);
          return;
        }
        const j: SlotsResponse = await res.json();
        setSlots(j.slots || []);
        setSeatsTaken(j.seatsTaken || {});
        setCapacity(j.capacity || 20);
        setDepositPerGuest(j.depositPerGuestUgx || 0);
        // Preselect the first free slot so "Book Now" is never a dead button.
        setTime((prev) => (j.slots || []).includes(prev) ? prev : (j.slots || [])[0] ?? "");
      } catch {
        setSlots([]);
      }
    },
    [],
  );

  useEffect(() => {
    if (active) void loadSlots(active.id, day);
  }, [active, day, loadSlots]);

  const closeSheet = () => {
    setActive(null);
    setTime("");
    setNote("");
    setError("");
    setDone(null);
  };

  const confirm = async () => {
    if (!active || !time) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantId: active.id, date: day, time, guests: party, note }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(j?.error || "Could not complete that booking.");
        return;
      }
      setDone({ reference: j.reference, record: j.booking });
      // Seat counts moved — refresh so the slot grid is honest.
      await loadSlots(active.id, day);
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  const deposit = party * depositPerGuest;

  return (
    <section id="book-a-table" className="border-b border-border py-14">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
              <CalendarCheck className="h-6 w-6 text-go" />
              Book a Table
            </h2>
            <p className="mt-1 text-sm text-muted">
              Reserve your spot at a GoDoor kitchen.{" "}
              {depositPerGuest > 0 ? `${depositPerGuest.toLocaleString("en-US")} UGX deposit per guest.` : "Free reservation."}
            </p>
          </div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-go/10 px-3 py-1.5 text-[11px] font-bold text-go">
            <Sparkles className="h-3 w-3" />
            New on GoDoor
          </p>
        </div>

        {/* Filters */}
        <div className="mt-6 space-y-4">
          {/* Cuisine */}
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCuisine(c)}
                aria-pressed={cuisine === c}
                className={`min-h-11 rounded-xl border px-4 text-xs font-bold transition ${
                  cuisine === c ? "border-go bg-go/10 text-go" : "border-border bg-surface text-muted hover:border-go/40"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Guests */}
          <div>
            <p className="mb-2 text-xs font-bold text-muted">Guests</p>
            <div className="flex flex-wrap gap-2">
              {GUESTS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setParty(g)}
                  aria-pressed={party === g}
                  aria-label={`${g} ${g === 1 ? "guest" : "guests"}`}
                  className={`num min-h-11 w-11 rounded-xl border text-xs font-bold transition ${
                    party === g ? "border-go bg-go/10 text-go" : "border-border bg-surface text-muted hover:border-go/40"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Restaurants */}
        {filtered.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
            No restaurants are taking table bookings yet.{" "}
            <Link href="/partner" className="font-bold text-go">
              List your kitchen
            </Link>
          </p>
        ) : (
          <ul className="mt-6 flex snap-x gap-4 overflow-x-auto pb-2 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
            {filtered.map((m) => {
              const img = m.shop_photo_url || m.logo_url;
              const rating = m.rating ?? 0;
              return (
                <li
                  key={m.id}
                  className="group w-[17rem] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-surface transition hover:shadow-pop sm:w-auto"
                >
                  <div className="relative h-32 overflow-hidden bg-elevated">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt={m.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-dim">
                        <CalendarCheck className="h-6 w-6" />
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <p className="truncate font-display text-sm font-bold">{m.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {m.tagline || m.category || "Restaurant"}
                    </p>

                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                      {rating > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-fg">
                          <Star className="h-3 w-3 fill-warning text-warning" />
                          <span className="num">{rating.toFixed(1)}</span>
                        </span>
                      )}
                      {m.district && (
                        <span className="inline-flex items-center gap-0.5 truncate">
                          <MapPin className="h-3 w-3" />
                          {m.district}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 flex items-center gap-1 text-[11px] text-dim">
                      <Clock className="h-3 w-3" />
                      <span className="num">
                        {m.opens_at ?? "17:00"} – {m.closes_at ?? "22:00"}
                      </span>
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setActive(m);
                        setDone(null);
                        setError("");
                      }}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-go px-4 text-xs font-bold text-white transition hover:bg-go-2 active:scale-[0.98]"
                    >
                      See available times
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Slot sheet */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="Close booking"
            onClick={closeSheet}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Book a table at ${active.name}`}
            className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-bg p-5 sm:rounded-3xl"
          >
            {done ? (
              <div className="py-6 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/12 text-success">
                  <Check className="h-7 w-7" />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold">Table booked</h3>
                <p className="mt-1 text-sm text-muted">
                  {active.name} · {done.record.date} at <span className="num font-semibold text-fg">{done.record.time}</span>
                </p>
                <p className="num mt-2 text-xs text-dim">Reference {done.reference}</p>

                <div className="mt-6 flex flex-col gap-2">
                  <Link
                    href="/account"
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-go px-5 text-sm font-bold text-white"
                  >
                    View in your account
                  </Link>
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="min-h-11 rounded-xl border border-border px-5 text-sm font-semibold text-muted"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-lg font-bold">{active.name}</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      <Users className="mr-1 inline h-3 w-3" />
                      {party} {party === 1 ? "guest" : "guests"}
                      {deposit > 0 && <span className="num"> · {deposit.toLocaleString("en-US")} UGX deposit</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeSheet}
                    aria-label="Close"
                    className="tap-44 relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Days */}
                <div className="mt-5 flex snap-x gap-2 overflow-x-auto pb-1">
                  {days.map((d) => (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => setDay(d.iso)}
                      aria-pressed={day === d.iso}
                      className={`min-h-11 shrink-0 snap-start rounded-xl border px-3.5 py-2 text-left transition ${
                        day === d.iso ? "border-go bg-go/10" : "border-border bg-surface hover:border-go/40"
                      }`}
                    >
                      <span className="block text-[11px] font-bold">{d.label}</span>
                      <span className="block text-[10px] text-muted">{d.num}</span>
                    </button>
                  ))}
                </div>

                {/* Slots */}
                <p className="mt-5 text-xs font-bold text-muted">Available times</p>
                {slots.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-border bg-surface p-4 text-center text-xs text-muted">
                    No tables left on this day. Try another date.
                  </p>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((s) => {
                      const left = capacity - (seatsTaken[s] ?? 0);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setTime(s)}
                          aria-pressed={time === s}
                          disabled={left < party}
                          className={`num min-h-11 rounded-xl border text-xs font-bold transition disabled:opacity-40 ${
                            time === s ? "border-go bg-go/10 text-go" : "border-border bg-surface hover:border-go/40"
                          }`}
                        >
                          {s}
                          <span className="block text-[9px] font-normal text-dim">{left} left</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Note */}
                <label className="mt-5 block text-xs font-bold text-muted">
                  Note for the restaurant (optional)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 280))}
                    rows={2}
                    placeholder="Window table, birthday, high chair…"
                    className="mt-1.5 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-go"
                  />
                </label>

                {error && (
                  <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                    {error}
                  </p>
                )}

                {!session.supabaseUser ? (
                  <div className="mt-5">
                    <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted">
                      Sign in to confirm your reservation.
                    </p>
                    <Link
                      href="/app"
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-go px-5 text-sm font-bold text-white"
                    >
                      Sign in to book
                    </Link>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!time || busy}
                    onClick={() => void confirm()}
                    className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-go px-5 text-sm font-bold text-white transition hover:bg-go-2 disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Booking…
                      </>
                    ) : (
                      <>
                        <CalendarCheck className="h-4 w-4" />
                        {time ? `Book ${time}` : "Pick a time"}
                      </>
                    )}
                  </button>
                )}

                {deposit > 0 && (
                  <p className="mt-2 text-center text-[11px] text-dim">
                    The deposit is held in your GoDoor Wallet escrow and applied to the bill.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}