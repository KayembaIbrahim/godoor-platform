import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { authorize, isUuid } from "@/lib/api-auth";
import { issueResetCode } from "@/lib/password-reset-server";
export const runtime = "nodejs";

type RiderOut = {
  id: string;
  email: string;
  name: string;
  phone: string;
  vehicle_type: string;
  plate: string;
  service_area: string;
  status: string;
  verified: boolean;
  total_deliveries: number;
  rating: number;
  created_at: number;
  // Live location fields
  current_lat?: number | null;
  current_lng?: number | null;
  current_heading?: number | null;
  current_speed?: number | null;
  current_accuracy?: number | null;
  last_updated?: string | null;
};

function rowToRider(r: any, email = ""): RiderOut {
  return {
    id: String(r.id),
    email: email || r.email || "",
    name: r.name || "Rider",
    phone: r.phone || "",
    vehicle_type: r.vehicle_type || "motorbike",
    plate: r.plate || "",
    service_area: r.service_area || "Uganda",
    status: r.status || "offline",
    verified: !!r.verified,
    total_deliveries: Number(r.total_deliveries || 0),
    rating: Number(r.rating || 4.5),
    created_at: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}


/**
 * Every rider whose auth account exists.
 *
 * The rider's `auth` id is the SAME uuid as `riders.id`, so the auth user is
 * found by id rather than by role. The old version filtered the auth list on
 * `user_metadata.role === "rider"`, which silently dropped riders whose
 * account role was never set to "rider" — one of the four live riders has
 * `role: "customer"` — so their account could not be password-reset at all.
 */
async function listRiderUsers(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users || [];
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const includeLocations = searchParams.get("include_locations") === "true";

  /*
   * ── Why there is no status filter here ──────────────────────────────────
   * This used to read `.eq("status", "active")`. The riders table has no
   * "active" status — the values the app actually writes are `online`,
   * `offline`, `busy` and `suspended` — so the filter matched nothing and the
   * admin Riders section was permanently empty. An admin console must show
   * EVERY rider, whatever their state, because "where is my rider?" is
   * exactly the question this screen exists to answer.
   *
   * The SELECT also asked for a `last_online` column that does not exist.
   * PostgREST rejects the whole query when one column is unknown, so this
   * route was answering 500 and the page silently fell back to the
   * RLS-restricted client read, which is empty for an admin session.
   */
  let q = sb.from("riders").select(
    "id, name, email, phone, vehicle_type, plate, service_area, lat, lng, status, verified, created_at, last_seen_at, rating, total_deliveries, job_mode, vehicle_photo_url, national_id_url",
  );

  if (includeLocations) {
    // Only a rider who is actually out on the road has a live location.
    q = q.in("status", ["online", "busy"]);
  }

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get rider locations for active riders
  if (includeLocations) {
    const riderIds = (data || []).map((r) => r.id);
    if (riderIds.length > 0) {
      const { data: locations } = await sb
        .from("rider_locations")
        .select("rider_id, lat, lng, heading, speed, accuracy, updated_at")
        .in("rider_id", riderIds);
      
      // Merge location data into rider response
      const ridersWithLocations = (data || []).map((rider) => {
        const location = locations?.find((l) => l.rider_id === rider.id);
        return {
          ...rider,
          current_lat: location?.lat || null,
          current_lng: location?.lng || null,
          current_heading: location?.heading || null,
          current_speed: location?.speed || null,
          current_accuracy: location?.accuracy || null,
          last_updated: location?.updated_at || null,
        };
      });
      return NextResponse.json({ riders: ridersWithLocations });
    }
  }

  return NextResponse.json({ riders: data || [] });
}

export async function POST(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const id: unknown = body?.id;
  const action: unknown = body?.action;
  const verified: unknown = body?.verified;
  if (typeof id !== "string" || typeof action !== "string") {
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
  }

  const user = (await listRiderUsers(sb)).find((u) => u.id === id);
  let row: any = null;
  try {
    const { data } = await sb.from("riders").select("*").eq("id", id).maybeSingle();
    if (data) row = data;
  } catch {}

  if (!row) {
    if (!user) return NextResponse.json({ error: "Rider account not found" }, { status: 404 });
    const insert = {
      id: user.id,
      name: (user.user_metadata?.name as string) || user.email || "Rider",
      email: user.email || "",
      vehicle_type: "motorbike",
      plate: "",
      service_area: "Uganda",
      lat: 0,
      lng: 0,
      status: "offline",
      verified: false,
    };
    const { data, error } = await sb.from("riders").insert(insert).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  }

  const riderId = String(row.id);
  let status: string = row.status || "offline";

  // Issue a one-time reset code + link for a rider who has forgotten their
  // password.
  //
  // This REPLACES the old behaviour, which overwrote the rider's password with
  // a temporary one and asked the admin to read it out over the phone. That
  // was a bearer secret travelling over one channel, it left a live
  // temporary password on the account if the admin never delivered it, and it
  // gave the rider no way to choose their own password.
  //
  // Now the rider receives a LINK and a CODE by two separate messages, and
  // sets their own password at /reset-password. The account's password is
  // not touched until that happens.
  if (action === "reset_password" || action === "issue_reset_code") {
    const { data: authUser } = await sb.auth.admin.getUserById(riderId);
    if (!authUser?.user) {
      return NextResponse.json({ error: "This rider has no login account to reset." }, { status: 404 });
    }
    const meta = authUser.user.user_metadata || {};
    const email = authUser.user.email || String(row.email || "");
    if (!email) {
      return NextResponse.json({ error: "This rider has no email address on their account." }, { status: 400 });
    }

    const issued = await issueResetCode(sb, {
      user_id: riderId,
      email,
      name: (meta.name as string) || (meta.full_name as string) || row.name || "",
      role: (meta.role as string) || "rider",
      issued_by: "admin",
    });
    if (!issued) {
      return NextResponse.json({ error: "Could not issue a reset code. Try again." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      id: issued.record.id,
      code: issued.code,
      email,
      expires_at: issued.record.expires_at,
      credentials: { email, password: issued.code },
      rider: rowToRider(row, email),
    });
  }

  if (action === "activate") status = "online";
  if (action === "suspend") status = "suspended";

  const update: Record<string, unknown> = { status };
  if (typeof verified === "boolean") update.verified = verified;
  await sb.from("riders").update(update).eq("id", riderId);

  const { data: fresh } = await sb.from("riders").select("*").eq("id", riderId).single();
  return NextResponse.json({ ok: true, rider: rowToRider(fresh || row, user?.email || "") });
}
