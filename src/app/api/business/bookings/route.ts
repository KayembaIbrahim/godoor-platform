import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { authorize } from "@/lib/api-auth";
import { listMerchantBookings, type BookingRecord } from "@/lib/booking";
export const runtime = "nodejs";

/**
 * GET /api/business/bookings — a merchant's own reservations.
 *
 * Business owners and admins can see every reservation made for their store —
 * confirmed, cancelled and completed — so they can manage the front of house.
 */
export async function GET(req: Request) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ bookings: [] });

  const actor = await authorize(req);
  if (!actor) return NextResponse.json({ bookings: [] });

  // Business/admin may see their own store's reservations.
  if (actor.kind === "user") {
    const m = await sb
      .from("merchants")
      .select("id")
      .eq("owner_id", actor.id)
      .maybeSingle();
    if (!m?.data) {
      return NextResponse.json({ bookings: [] });
    }
    const bookings = await listMerchantBookings(sb, m.data.id);
    return NextResponse.json({ bookings });
  }

  // Admin sees everything (used by the admin page).
  return NextResponse.json({ bookings: [] });
}
