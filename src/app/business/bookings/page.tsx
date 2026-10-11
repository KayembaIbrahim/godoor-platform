"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarCheck, CheckCircle2, XCircle, Loader2, Users, Utensils, RotateCcw, Clock } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { apiAuthHeaders } from "@/lib/db";
import { Price } from "@/components/Price";

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
  cancelledAt: string | null;
};

const STATUS_TONE: Record<Rec["status"], string> = {
  confirmed: "bg-go/10 text-go",
  cancelled: "bg-danger/10 text-danger",
  completed: "bg-success/10 text-success",
};

const statusLabel: Record<Rec["status"], string> = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
};

const fmt = (n: unknown) => `UGX ${Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-US")}`;

export default function BusinessBookingsPage() {
  const { supabaseUser } = useSession();
  const [bookings, setBookings] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "confirmed">("confirmed");

  const load = useCallback(async () => {
    if (!supabaseUser?.id) return;
    try {
      const res = await fetch("/api/business/bookings", {
        cache: "no-store",
        headers: await apiAuthHeaders(false),
      });
      const json = await res.json().catch(() => ({}));
      setBookings((json.bookings || []).map((b: any) => ({
        id: b.id,
        merchantId: b.merchantId,
        merchantName: b.merchantName,
        userName: b.userName,
        userEmail: b.userEmail,
        date: b.date,
        time: b.time,
        guests: Number(b.guests),
        depositUgx: Number(b.depositUgx),
        status: (b.status as Rec["status"]) || "confirmed",
        note: b.note || "",
        createdAt: b.createdAt || "",
        cancelledAt: b.cancelledAt || null,
      })));
    } catch { setBookings([]); }
    setLoading(false);
  }, [supabaseUser?.id]);

  useEffect(() => { load(); }, [load]);

  const cancelBooking = async (id: string) => {
    if (!confirm("Cancel this reservation? The seats will be released back to the restaurant.")) return;
    setBusy(id);
    try {
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.booking) {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)));
      } else {
        const err = typeof j?.error === "string" ? j.error : "Could not cancel booking.";
        alert(err);
      }
    } catch {
      alert("Network error. Try again.");
    }
    setBusy(null);
  };

  const completeBooking = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ id, action: "complete" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.booking) {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "completed" } : b)));
      } else {
        alert(j?.error || "Could not mark booking as completed.");
      }
    } catch {
      alert("Network error. Try again.");
    }
    setBusy(null);
  };

  const shown = useMemo(() => {
    const base = filter === "confirmed" ? bookings.filter((b) => b.status === "confirmed") : bookings;
    return [...base].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }, [bookings, filter]);

  const liveCount = bookings.filter((b) => b.status === "confirmed").length;

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-bg pb-16">
      <div className="border-b border-border bg-surface/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/business" className="text-muted hover:text-fg transition"><ArrowLeft className="h-5 w-5" /></Link>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10"><Utensils className="h-4 w-4 text-primary" /></span>
          <div>
            <h1 className="font-display text-base font-semibold">Bookings</h1>
            <p className="text-[10px] text-muted">Table reservations for your restaurant</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Utensils className="h-4 w-4 text-primary" />
            Reservations
            {bookings.length > 0 && <span className="num rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold text-muted">{bookings.length}</span>}
          </h2>
          <div className="flex items-center gap-1.5">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as "all" | "confirmed")}
              className="rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs outline-none ring-primary focus:ring-2"
            >
              <option value="confirmed">Upcoming</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center">
            <Utensils className="mx-auto h-7 w-7 text-dim" />
            <p className="mt-2 text-sm font-medium">{liveCount > 0 ? "No upcoming reservations" : "No reservations yet"}</p>
            <p className="text-xs text-muted mt-1">
              {liveCount > 0
                ? "All confirmed tables for this period have been served or cancelled."
                : "Reservations made from the GoDoor homepage will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {shown.map((b) => (
              <div key={b.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold truncate">{b.userName}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${STATUS_TONE[b.status]}`}>
                        {statusLabel[b.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-muted">
                      <span className="flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" /> {b.date}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {b.time}</span>
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {b.guests} guest{b.guests !== 1 ? "s" : ""}</span>
                    </div>
                    {b.note && <p className="mt-1 text-xs text-muted truncate">{b.note}</p>}
                    {b.depositUgx > 0 && (
                      <p className="mt-1 text-xs font-semibold text-primary">Deposit held: <Price amount={b.depositUgx} className="inline" /></p>
                    )}
                    <p className="mt-1 text-[10px] text-dim">Booked {new Date(b.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</p>
                  </div>
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => cancelBooking(b.id)}
                      disabled={busy === b.id || b.status !== "confirmed"}
                      className="grid h-9 w-9 place-items-center rounded-full bg-elevated text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                      title="Cancel booking"
                    >
                      {busy === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {b.status === "confirmed" && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => completeBooking(b.id)}
                      disabled={busy === b.id}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-success/15 px-3 py-2 text-[10px] font-semibold text-success transition hover:bg-success/25 disabled:opacity-50"
                    >
                      {busy === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Mark served
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelBooking(b.id)}
                      disabled={busy === b.id}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-danger/15 px-3 py-2 text-[10px] font-semibold text-danger transition hover:bg-danger/25 disabled:opacity-50"
                    >
                      {busy === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                      Cancel table
                    </button>
                  </div>
                )}
                {b.status === "completed" && (
                  <p className="mt-2 text-[10px] text-success flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Party arrived and served</p>
                )}
                {b.status === "cancelled" && (
                  <p className="mt-2 text-[10px] text-muted flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Cancelled — table released</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
