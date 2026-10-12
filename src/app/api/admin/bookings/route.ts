import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import {
  listAllBookings,
  readBooking,
  readBookingConfig,
  saveBooking,
  writeBookingConfig,
  resolveBookingConfig,
  type BookingRecord,
} from "@/lib/booking";

/**
 * Admin view of table reservations.
 *
 * Two jobs. First, the book: see who reserved, when, how many covers, and
 * whether it is coming up or already past. Second, the controls — switch
 * booking on or off, set the party-size ceiling, and decide whether a
 * deposit is held (it ships at 0, i.e. a free reservation).
 *
 * `enabled` gates a money-adjacent flow, so it ships off and is an explicit
 * operator decision. Cancelling frees the seats for anyone else to rebook.
 */

async function authed() {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value || "");
}

const ConfigPatch = z.object({
  enabled: z.boolean().optional(),
  max_guests: z.coerce.number().int().min(1).max(100).optional(),
  deposit_per_guest_ugx: z.coerce.number().int().min(0).max(100_000).optional(),
  advance_days: z.coerce.number().int().min(1).max(365).optional(),
  min_notice_minutes: z.coerce.number().int().min(0).max(10_080).optional(),
});

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const [records, config] = await Promise.all([listAllBookings(sb), readBookingConfig(sb)]);
  return NextResponse.json({ bookings: records, config });
}

export async function PATCH(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const parsed = ConfigPatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the booking settings and try again" }, { status: 400 });
  }

  const current = await readBookingConfig(sb);
  const next = resolveBookingConfig({
    ...current,
    ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
    ...(parsed.data.max_guests === undefined ? {} : { maxGuests: parsed.data.max_guests }),
    ...(parsed.data.deposit_per_guest_ugx === undefined ? {} : { depositPerGuestUgx: parsed.data.deposit_per_guest_ugx }),
    ...(parsed.data.advance_days === undefined ? {} : { advanceDays: parsed.data.advance_days }),
    ...(parsed.data.min_notice_minutes === undefined ? {} : { minNoticeMinutes: parsed.data.min_notice_minutes }),
  });

  await writeBookingConfig(sb, next);
  return NextResponse.json({ config: next });
}

const Decision = z.object({
  id: z.string().min(1),
  action: z.enum(["cancel", "complete"]),
});

/** POST — decide a reservation. */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const parsed = Decision.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown booking action" }, { status: 400 });
  }

  const rec = await readBooking(sb, parsed.data.id);
  if (!rec) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  // Only a live booking can be decided — a double click cannot cancel twice
  // or resurrect a cancelled table.
  if (rec.status !== "confirmed") {
    return NextResponse.json({ error: "That booking is already closed" }, { status: 409 });
  }

  const cancelling = parsed.data.action === "cancel";
  const updated: BookingRecord = {
    ...rec,
    status: cancelling ? "cancelled" : "completed",
    cancelledAt: cancelling ? new Date().toISOString() : null,
  };

  const saved = await saveBooking(sb, { rec: updated, skipSeatCheck: true });
  return NextResponse.json({ booking: saved.ok ? saved.record : updated });
}
export const runtime = "edge";
