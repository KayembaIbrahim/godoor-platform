import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

type MerchantOut = {
  id: string;
  owner_id?: string;
  email: string;
  name: string;
  verified: boolean;
  category: string;
  tagline: string;
  area: string;
  district: string;
  lat: number;
  lng: number;
  momo_number: string;
  momo_name: string;
  opens_at: string;
  closes_at: string;
  delivery_fee_ugx: number;
  rating: number;
  status: "active" | "suspended" | "pending";
  logo_url: string;
  created_at: number;
};

const STATUSES = ["active", "suspended", "pending"] as const;

function rowToMerchant(r: any, email = ""): MerchantOut {
  return {
    id: String(r.id),
    owner_id: r.owner_id ? String(r.owner_id) : undefined,
    email: email || r.email || "",
    name: r.name || "Business",
    verified: !!r.verified,
    category: r.category || "Business",
    tagline: r.tagline || "",
    area: r.area || "Uganda",
    district: r.district || "",
    lat: Number(r.lat || 0),
    lng: Number(r.lng || 0),
    momo_number: r.momo_number || "",
    momo_name: r.momo_name || "",
    opens_at: r.opens_at || "",
    closes_at: r.closes_at || "",
    delivery_fee_ugx: Number(r.delivery_fee_ugx || 0),
    rating: Number(r.rating || 0),
    status: (STATUSES.includes(r.status) ? r.status : "pending") as MerchantOut["status"],
    logo_url: r.logo_url || "",
    created_at: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  // Fetch all auth users once for email/name lookups
  const { data: usersRes } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const allUsers = usersRes?.users || [];

  // Build lookup maps from auth users
  const userById = new Map<string, any>();
  const userByEmail = new Map<string, any>();
  for (const u of allUsers) {
    userById.set(u.id, u);
    if (u.email) userByEmail.set(String(u.email).toLowerCase(), u);
  }

  // Fetch ALL merchants from the merchants table — this is the source of truth
  let merchantRows: any[] = [];
  try {
    const { data } = await sb.from("merchants").select("*").order("created_at", { ascending: false });
    merchantRows = data || [];
  } catch {}

  // Build the list starting from ALL merchant rows
  const businesses: MerchantOut[] = merchantRows.map((row) => {
    // Try to find the owner's email from auth users
    let email = "";
    if (row.owner_id) {
      const owner = userById.get(String(row.owner_id));
      if (owner) email = owner.email || "";
    }
    // Fallback: try matching by name
    if (!email) {
      const match = allUsers.find(
        (u) => String(u.user_metadata?.name || "").toLowerCase() === String(row.name || "").toLowerCase()
      );
      if (match) email = match.email || "";
    }
    return rowToMerchant(row, email);
  });

  // Also add any auth business users that DON'T have a merchant row yet (pending onboarding)
  const merchantOwnerIds = new Set(merchantRows.map((r) => String(r.owner_id || "")));
  const businessUsers = allUsers.filter((u) => (u.user_metadata?.role as string) === "business");

  for (const u of businessUsers) {
    if (merchantOwnerIds.has(u.id)) continue; // Already shown
    // Check by name match too
    const nameMatch = merchantRows.find(
      (r) => String(r.name || "").toLowerCase() === String(u.user_metadata?.name || "").toLowerCase()
    );
    if (nameMatch) continue; // Already shown via name match
    businesses.push({
      id: u.id,
      owner_id: u.id,
      email: u.email || "",
      name: (u.user_metadata?.name as string) || u.email || "Business",
      verified: false,
      category: "Business",
      tagline: "",
      area: "Uganda",
      district: "",
      lat: 0,
      lng: 0,
      momo_number: "",
      momo_name: "",
      opens_at: "",
      closes_at: "",
      delivery_fee_ugx: 2000,
      rating: 0,
      status: "pending",
      logo_url: "",
      created_at: new Date(u.created_at || Date.now()).getTime(),
    });
  }

  businesses.sort((a, b) => b.created_at - a.created_at);
  return NextResponse.json({ businesses });
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

  // Find the merchant row — try by id first, then by owner_id
  let row: any = null;
  try {
    const { data } = await sb.from("merchants").select("*").eq("id", id).maybeSingle();
    if (data) row = data;
  } catch {}
  if (!row) {
    try {
      const { data } = await sb.from("merchants").select("*").eq("owner_id", id).maybeSingle();
      if (data) row = data;
    } catch {}
  }

  // Find the auth user for this business
  const { data: usersRes } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (usersRes?.users || []).find((u) => u.id === id);

  if (!row) {
    if (!user) return NextResponse.json({ error: "Business account not found" }, { status: 404 });
    const insert = {
      name: (user.user_metadata?.name as string) || user.email || "Business",
      category: "Business",
      tagline: "",
      area: "Uganda",
      district: "",
      lat: 0,
      lng: 0,
      momo_number: "",
      momo_name: "",
      opens_at: "",
      closes_at: "",
      delivery_fee_ugx: 2000,
      rating: 0,
      status: "pending",
      verified: false,
      owner_id: user.id,
    };
    const { data, error } = await sb.from("merchants").insert(insert).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    row = data;
  }

  const merchantId = String(row.id);
  let status: string = row.status || "pending";
  if (action === "approve") status = "active";
  if (action === "suspend") status = "suspended";
  if (typeof verified === "boolean" && verified) status = "active";

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (typeof verified === "boolean") update.verified = verified;
  await sb.from("merchants").update(update).eq("id", merchantId);

  const { data: fresh } = await sb.from("merchants").select("*").eq("id", merchantId).single();
  return NextResponse.json({ ok: true, merchant: rowToMerchant(fresh || row, user?.email || "") });
}
