import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Business & rider applications to join GoDoor.
 *
 * GoDoor runs admin-managed onboarding: there is no business/rider
 * self-signup. Anyone who wants to be listed (or to deliver) submits an
 * application here. It lands in the admin portal where the team reviews it
 * (and forwards it to the marketing director) before creating any accounts.
 */

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS partner_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'business',
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  credentials_issued BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_status ON partner_requests(status);
CREATE INDEX IF NOT EXISTS idx_partner_role ON partner_requests(role);
ALTER TABLE partner_requests ADD COLUMN IF NOT EXISTS credentials_issued BOOLEAN NOT NULL DEFAULT false;`;

async function ensureTable(sb: NonNullable<ReturnType<typeof getServiceClient>>) {
  try { await sb.rpc("exec_sql", { query: CREATE_SQL }); } catch {}
  const { error } = await sb.from("partner_requests").select("id", { count: "exact", head: true });
  if (error) console.error("[partner_requests] Table may not exist:", error.message);
}

const STATUSES = ["new", "contacted", "approved", "rejected"];

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function clamp(s: unknown, max = 300): string {
  return String(s ?? "").trim().slice(0, max);
}

/**
 * Last-resort delivery path. If we cannot store the application we still must
 * get it to the team, so we hand the applicant a pre-filled WhatsApp message
 * instead of letting the request disappear.
 */
const SUPPORT_WA = "https://wa.me/256750685772";

function whatsappFallback(a: {
  role: string; contactName: string; phone: string; email: string;
  businessName: string; area: string;
}): string {
  const summary = [
    `GoDoor ${a.role === "rider" ? "Rider" : "Business"} application`,
    `Name: ${a.contactName}`,
    `Phone: ${a.phone || "not given"}`,
    `Email: ${a.email || "not given"}`,
    a.businessName ? `Business: ${a.businessName}` : "",
    a.area ? `Area: ${a.area}` : "",
  ].filter(Boolean).join("\n");
  return `${SUPPORT_WA}?text=${encodeURIComponent(summary)}`;
}

/**
 * One-time password for newly approved riders. 10 chars, unambiguous
 * alphabet (no 0/O/1/l/I) so an admin can read it out over the phone.
 */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length];
  return out;
}

type CredRequest = {
  contactName: string;
  email: string;
  phone: string;
  vehicle?: string;
  area?: string;
};

/**
 * Create (or reset) the rider's login account and ensure their riders row
 * exists. Always returns a fresh one-time password. The plaintext password is
 * ONLY returned once, in the response to this call — never persisted.
 *
 * Idempotent: if the Supabase user already exists we just reset its password
 * to a new one-time password and set the must-change flag again. This means an
 * already-approved application (e.g. approved before credentials existed) can
 * be re-approved to issue credentials without jamming.
 */
async function issueRiderCredentials(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  req: CredRequest,
): Promise<{ email: string; password: string; userId: string }> {
  const email = req.email.toLowerCase().trim();
  const password = generateTempPassword();
  const found = async () => {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    return (data?.users || []).find((u) => String(u.email || "").toLowerCase() === email) || null;
  };

  let user = await found();
  let userId = user?.id || "";

  if (!user) {
    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: req.contactName, role: "rider", must_change_password: true },
    });
    if (error) {
      // A race could still land on "already registered" — resolve by email.
      if (!/already|exists|registered/i.test(error.message)) throw new Error(error.message);
      user = await found();
      if (!user) throw error;
    } else {
      user = created.user || null;
    }
    userId = user?.id || "";
  }

  if (!userId) throw new Error("Could not provision a rider account");

  // User exists → reset to a fresh one-time password (keeps role, forces change).
  const prevMeta = user?.user_metadata || {};
  const { error: updErr } = await sb.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { ...prevMeta, name: req.contactName, role: "rider", must_change_password: true },
  });
  if (updErr) throw new Error(updErr.message);

  // Ensure the riders row exists (don't clobber an existing rider's data).
  const { data: row } = await sb.from("riders").select("id").eq("id", userId).maybeSingle();
  if (!row) {
    await sb.from("riders").insert({
      id: userId,
      name: req.contactName,
      email,
      phone: req.phone,
      vehicle_type: req.vehicle || "motorbike",
      plate: "",
      service_area: req.area || "Uganda",
      lat: 0,
      lng: 0,
      status: "offline",
      verified: false,
      total_deliveries: 0,
      rating: 4.5,
    });
  }

  return { email, password, userId };
}

/**
 * Abuse guard for a public, unauthenticated form.
 *
 * Only *stored* applications count. Two reasons:
 *  1. A typo or an incomplete form must never cost someone their slot. The
 *     previous guard counted every POST, so a few misfires locked you out.
 *  2. Ugandan mobile carriers put thousands of subscribers behind a single
 *     public IP (carrier-grade NAT), so a tight per-IP ceiling rejects real
 *     applicants rather than abusers — and their request is lost with no trace.
 *
 * The ceiling is therefore deliberately high and the window long: a spam
 * speed-bump, not a quota. Bot traffic is handled by the honeypot.
 */
const MAX_STORED_PER_IP = 60; // per hour, counted only after a successful insert
const WINDOW_MS = 60 * 60 * 1000;
const stored: Map<string, number[]> = new Map();

function tooManyStored(key: string): boolean {
  const now = Date.now();
  const hits = (stored.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_STORED_PER_IP) {
    stored.set(key, hits);
    return true;
  }
  // Drop emptied keys so the map cannot grow without bound on a long-lived instance.
  if (hits.length) stored.set(key, hits);
  else stored.delete(key);
  return false;
}

function recordStored(key: string): void {
  const now = Date.now();
  const hits = (stored.get(key) || []).filter((t) => now - t < WINDOW_MS);
  stored.set(key, [...hits, now]);
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  await ensureTable(sb);

  const body = await req.json().catch(() => ({}));

  // Honeypot — bots fill hidden fields. If set, pretend success but store nothing.
  if (body.website) {
    return NextResponse.json({ ok: true });
  }

  const role = body.role === "rider" ? "rider" : "business";
  const contactName = clamp(body.contact_name, 120);
  const email = clamp(body.email, 160).toLowerCase();
  const phone = clamp(body.phone, 40);
  const businessName = clamp(body.business_name, 200);
  const category = clamp(body.category, 80);
  const area = clamp(body.area, 160);
  const district = clamp(body.district, 120);
  const details = clamp(body.details, 1500);

  if (!contactName) {
    return NextResponse.json({ error: "Tell us who to contact." }, { status: 400 });
  }
  if (!isEmail(email) && phone.length < 9) {
    return NextResponse.json({ error: "We need a valid email or phone number." }, { status: 400 });
  }
  if (role === "business" && !businessName) {
    return NextResponse.json({ error: "Enter your business name." }, { status: 400 });
  }

  // Gate spam after validation (so a typo never costs a slot) but before the
  // insert, and never drop the applicant silently — hand back a WhatsApp link.
  if (tooManyStored(ip)) {
    return NextResponse.json({
      error:
        "Our application form is getting a lot of traffic right now. Please send your application to us on WhatsApp so we do not lose it.",
      fallback: whatsappFallback({ role, contactName, phone, email, businessName, area }),
    }, { status: 429 });
  }

  const { error } = await sb.from("partner_requests").insert({
    role,
    contact_name: contactName,
    email,
    phone,
    business_name: businessName,
    category,
    area,
    district,
    details,
    status: "new",
  });

  if (error) {
    // Never let an application vanish silently. Log loudly, tell the applicant
    // exactly what happened, and hand back a pre-filled WhatsApp link so the
    // team still receives the request even if the database is unreachable.
    console.error("[partner-request] insert failed:", error.message, {
      role, contactName, email, phone, businessName, area,
    });
    return NextResponse.json({
      error:
        "We could not save your application just now. Please send it to us on WhatsApp so we do not lose it.",
      fallback: whatsappFallback({ role, contactName, phone, email, businessName, area }),
    }, { status: 503 });
  }

  recordStored(ip);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  if (!(await verifySession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ requests: [] });

  await ensureTable(sb);

  const { data, error } = await sb
    .from("partner_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ requests: [] });
  return NextResponse.json({ requests: data || [] });
}

export async function PATCH(req: NextRequest) {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  if (!(await verifySession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid application id" }, { status: 400 });
  }

  await ensureTable(sb);

  const patch: Record<string, unknown> = {};
  if (typeof body.status === "string" && STATUSES.includes(body.status)) {
    patch.status = body.status;
  }
  if (typeof body.admin_note === "string") {
    patch.admin_note = body.admin_note.trim().slice(0, 800) || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  patch.reviewed_by = "admin";
  patch.reviewed_at = new Date().toISOString();

  // Fetch the application so rider approvals can be provisioned with a login.
  const { data: application } = await sb.from("partner_requests").select("*").eq("id", id).maybeSingle();

  const { error } = await sb.from("partner_requests").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rider approval → create the login account + one-time password. The
  // credentials are returned exactly once; credentials_issued guards re-runs.
  if (
    patch.status === "approved" &&
    application?.role === "rider" &&
    !application?.credentials_issued &&
    isEmail(String(application.email || ""))
  ) {
    try {
      const creds = await issueRiderCredentials(sb, {
        contactName: clamp(application.contact_name, 120),
        email: String(application.email),
        phone: clamp(application.phone, 40),
        vehicle: clamp(application.category, 80),
        area: clamp(application.area, 160),
      });
      await sb.from("partner_requests").update({ credentials_issued: true }).eq("id", id);
      return NextResponse.json({ ok: true, credentials: { email: creds.email, password: creds.password } });
    } catch (e: any) {
      console.error("[partner-request] credential issuance failed:", e?.message || e);
      return NextResponse.json(
        { ok: true, error: "Application approved but provisioning failed. Try Approve again: " + (e?.message || "unknown error") },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}