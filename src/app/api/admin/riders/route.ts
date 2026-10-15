import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { authorize, isUuid } from "@/lib/api-auth";
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

/** Short unambiguous one-time password (no 0/O/1/l/I). */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function listRiderUsers(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (data?.users || []).filter((u) => (u.user_metadata?.role as string) === "rider");
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
  let q = sb.from("riders").select("id, name, email, phone, vehicle_type, plate, service_area, lat, lng, status, verified, created_at, last_online, rating");
  
  if (includeLocations) {
    q = q.eq("status", "active");
  } else {
    q = q.eq("status", "active");
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

  // Reset to a fresh one-time password. The plaintext is returned exactly once
  // so the admin can relay it; the rider is forced to change it on next login.
  if (action === "reset_password") {
    const password = generateTempPassword();
    const { data: authUser } = await sb.auth.admin.getUserById(riderId);
    const meta = authUser?.user?.user_metadata || {};
    const { error: pwErr } = await sb.auth.admin.updateUserById(riderId, {
      password,
      user_metadata: { ...meta, must_change_password: true },
    });
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 400 });
    await sb.from("riders").update({ status }).eq("id", riderId);
    const { data: freshPw } = await sb.from("riders").select("*").eq("id", riderId).single();
    return NextResponse.json({
      ok: true,
      credentials: { email: user?.email || String(row.email || ""), password },
      rider: rowToRider(freshPw || row, user?.email || ""),
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
