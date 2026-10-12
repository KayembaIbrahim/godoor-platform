import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import {
  readBookingConfig,
  listMerchantBookings,
  listUserBookings,
  saveBooking,
  claimSlotLock,
  releaseSlotLock,
  validateBooking,
  availableSlots,
  bookingDeposit,
  newBookingId,
  bookingReference,
  kampalaDate,
  DEFAULT_BOOKING_CONFIG,
  type BookingRecord,
} from "@/lib/booking";

export const runtime = "nodejs";

/** Seats a single slot can absorb. */
const SLOT_CAPACITY = 20;

/**
 * GET /api/bookings
 *
 *   ?merchant_id=<id>[&date=YYYY-MM-DD]  → slots + seats for one restaurant
 *   (no params, signed in)                → the caller's reservations
 *
 * Public on purpose: the landing page shows availability before anyone signs
 * in, exactly like the campaign feed. It exposes slot times and how many seats
 * are left — never who booked them.
 */
export async function GET(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ bookings: [] });

  const url = new URL(req.url);
  const merchantId = url.searchParams.get("merchant_id");

  if (!merchantId) {
    const actor = await authorize(req);
    if (!actor || actor.kind !== "user") return NextResponse.json({ bookings: [] });
    return NextResponse.json({ bookings: await listUserBookings(sb, actor.id) });
  }

  const cfg = await readBookingConfig(sb);
  const date = url.searchParams.get("date") || kampalaDate();

  const [{ data: merchant }, records] = await Promise.all([
    sb.from("merchants").select("name, opens_at, closes_at").eq("id", merchantId).maybeSingle(),
    listMerchantBookings(sb, merchantId),
  ]);

  if (!merchant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  const slots = availableSlots(
    { opensAt: merchant.opens_at, closesAt: merchant.closes_at },
    {
      date,
      minNoticeMinutes: cfg.minNoticeMinutes,
      seatsTaken: seatsFrom(records, date),
      capacity: SLOT_CAPACITY,
    },
  );

  return NextResponse.json({
    date,
    slots,
    seatsTaken: seatsFrom(records, date),
    capacity: SLOT_CAPACITY,
    depositPerGuestUgx: cfg.depositPerGuestUgx,
  });
}

/**
 * POST /api/bookings — create a reservation. Sign-in required.
 *
 * The seat check happens twice: once here, and again inside saveBooking while
 * the per-slot lock is held. The second check is the one that matters; the
 * first only lets us fail fast with a friendlier message.
 */
export async function POST(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to book a table" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const cfg = await readBookingConfig(sb);

  // Guests may never book before the operator has switched the feature on.
  if (!cfg.enabled) {
    return NextResponse.json({ error: "Table booking is not available yet" }, { status: 503 });
  }

  const merchantId = typeof body.merchantId === "string" ? body.merchantId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const guests = Number(body.guests);
  const note = typeof body.note === "string" ? body.note.slice(0, 280) : "";

  const { data: merchant } = await sb
    .from("merchants")
    .select("name, opens_at, closes_at")
    .eq("id", merchantId)
    .maybeSingle();

  if (!merchant) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  const existing = await listMerchantBookings(sb, merchantId);
  const slots = availableSlots(
    { opensAt: merchant.opens_at, closesAt: merchant.closes_at },
    {
      date,
      minNoticeMinutes: cfg.minNoticeMinutes,
      seatsTaken: seatsFrom(existing, date),
      capacity: SLOT_CAPACITY,
    },
  );

  const problem = validateBooking({
    merchantName: merchant.name,
    date,
    time,
    guests,
    slots,
    cfg,
  });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // The lock is a unique-key INSERT, so two people racing for the last seat
  // cannot both proceed — one wins, one backs off and retries.
  const locked = await claimSlotLock(sb, merchantId, date, time);
  if (!locked) {
    return NextResponse.json(
      { error: "That slot is being booked right now. Please try again." },
      { status: 409 },
    );
  }

  try {
    const id = newBookingId();
    const rec: BookingRecord = {
      id,
      merchantId,
      merchantName: merchant.name,
      userId: actor.id,
      userName: actor.name || "GoDoor guest",
      userEmail: actor.email || "",
      date,
      time,
      guests: Math.trunc(guests),
      depositUgx: bookingDeposit(guests, cfg),
      status: "confirmed",
      note,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
    };

    const saved = await saveBooking(sb, { rec, capacity: SLOT_CAPACITY });
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 409 });

    return NextResponse.json({ booking: saved.record, reference: bookingReference(saved.record.id) });
  } finally {
    // Always release, even on failure, or the slot would be permanently locked.
    await releaseSlotLock(sb, merchantId, date, time);
  }
}

/** PATCH /api/bookings — cancel one of your own reservations. */
export async function PATCH(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing booking reference" }, { status: 400 });

  const locked = await claimSlotLock(sb, "__cancel__", id, "0");
  if (!locked) return NextResponse.json({ error: "Please try again." }, { status: 409 });

  try {
    const { readBooking } = await import("@/lib/booking");
    const rec = await readBooking(sb, id);
    // Ownership check, or anyone could cancel a stranger's table.
    if (!rec) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (rec.userId !== actor.id) return NextResponse.json({ error: "That is not your booking" }, { status: 403 });
    if (rec.status !== "confirmed") {
      return NextResponse.json({ error: "That booking is already closed" }, { status: 409 });
    }

    const saved = await saveBooking(sb, {
      rec: { ...rec, status: "cancelled", cancelledAt: new Date().toISOString() },
      skipSeatCheck: true,
    });
    return NextResponse.json({ booking: saved.ok ? saved.record : rec });
  } finally {
    await releaseSlotLock(sb, "__cancel__", id, "0");
  }
}

function seatsFrom(records: BookingRecord[], date: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    if (r.date !== date || r.status !== "confirmed") continue;
    out[r.time] = (out[r.time] ?? 0) + Math.max(0, r.guests);
  }
  return out;
}

export { DEFAULT_BOOKING_CONFIG };