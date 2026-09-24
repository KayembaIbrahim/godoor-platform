import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

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

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const users = await listRiderUsers(sb);
  let rows: any[] = [];
  try {
    const { data } = await sb.from("riders").select("*");
    rows = data || [];
  } catch {}

  const byId = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const r of rows) {
    byId.set(String(r.id), r);
    if (r.email) byEmail.set(String(r.email).toLowerCase(), r);
  }

  const riders: RiderOut[] = users.map((u) => {
    const row = byId.get(u.id) || byEmail.get(String(u.email || "").toLowerCase());
    if (row) return rowToRider(row, u.email || "");
    return {
      id: u.id,
      email: u.email || "",
      name: (u.user_metadata?.name as string) || u.email || "Rider",
      phone: "",
      vehicle_type: "motorbike",
      plate: "",
      service_area: "Uganda",
      status: "offline",
      verified: false,
      total_deliveries: 0,
      rating: 4.5,
      created_at: new Date(u.created_at || Date.now()).getTime(),
    };
  });

  riders.sort((a, b) => b.created_at - a.created_at);
  return NextResponse.json({ riders });
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
