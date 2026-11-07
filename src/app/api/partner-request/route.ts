import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
export const runtime = "nodejs";

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
  role?: "rider" | "business";
  businessName?: string;
};

/**
 * Generic provisioner for BOTH riders and business owners.
 *
 * Returns a fresh one-time password (plaintext, once-only in the response),
 * creates or finds the Supabase auth user by email, sets must_change_password,
 * and links the domain row (riders.id / merchants.owner_id).
 */

/**
 * Canonicalise a free-text category from the partner form into a CATEGORIES id.
 *
 * The partner form offers short labels ("Groceries", "Electronics", "Hardware")
 * while the catalogue matches on canonical ids ("Groceries & Market",
 * "Electronics & Gadgets", "Hardware & Building"). Without this step a business
 * approved at /admin/applications keeps its form category and then fails
 * matchCategory() server-side, so it never appears under its browse category.
 */
const CATEGORY_ALIAS: Record<string, string> = {
  "groceries": "Groceries & Market",
  "groceries & market": "Groceries & Market",
  "supermarket": "Groceries & Market",
  "market": "Groceries & Market",
  "food & restaurants": "Food & Restaurants",
  "food": "Food & Restaurants",
  "pharmacy": "Pharmacy",
  "clothing & fashion": "Clothing & Fashion",
  "electronics": "Electronics & Gadgets",
  "electronics & gadgets": "Electronics & Gadgets",
  "furniture & home": "Furniture & Appliances",
  "furniture": "Furniture & Appliances",
  "furniture & appliances": "Furniture & Appliances",
  "hardware": "Hardware & Building",
  "hardware & building": "Hardware & Building",
  "beauty & salon": "Beauty & Personal Care",
  "beauty": "Beauty & Personal Care",
  "beauty & personal care": "Beauty & Personal Care",
  "other": "Delivery & Courier",
};

function canonicalCategory(raw: string): string {
  const key = (raw || "").trim().toLowerCase().replace(/\s*&\s*/g, " & ");
  return CATEGORY_ALIAS[key] || (raw || "Delivery & Courier").trim() || "Delivery & Courier";
}

/**
 * Create (or reset) the rider's login account and ensure their riders row
 * exists. Always returns a fresh one-time password. The plaintext password is
 * ONLY returned once, in the response to this call — never persisted.
 *
 * Idempotent: if the Supabase user already exists we just reset its password
 * to a new one-time password and set the must-change flag again. This means an
 * already-approved application (e.g. approved before credentials existed) can
 * be re-approved to issue credentials without jamming.
 *
 * role="business" variant: same login provisioning for a business owner, but
 * the linked row is `merchants.owner_id` (no riders row). This closes the
 * Asu Snacks gap — an approved business with no auth user can never sign in,
 * and the reset system cannot issue a code for a user_id that does not exist.
 */
async function issueRiderCredentials(
  sb: NonNullable<ReturnType<typeof getServiceClient>>,
  req: CredRequest,
): Promise<{ email: string; password: string; userId: string }> {
  const email = req.email.toLowerCase().trim();
  const password = generateTempPassword();
  const acctRole: "rider" | "business" = req.role === "business" ? "business" : "rider";
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
      user_metadata: { name: req.contactName, role: acctRole, must_change_password: true },
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

  if (!userId) throw new Error(acctRole === "business" ? "Could not provision a business account" : "Could not provision a rider account");

  // User exists → reset to a fresh one-time password (keeps role, forces change).
  const prevMeta = user?.user_metadata || {};
  const { error: updErr } = await sb.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { ...prevMeta, name: req.contactName, role: acctRole, must_change_password: true },
  });
  if (updErr) throw new Error(updErr.message);

  if (acctRole === "business") {
    // Business login: link the auth user as merchants.owner_id (no riders row).
    // Idempotent: only claim an un-owned merchant, or re-claim the same owner.
    try {
      const bizName = clamp(req.businessName || "", 200);
      if (bizName) {
        const { data: m } = await sb.from("merchants").select("id, owner_id").ilike("name", bizName).limit(1);
        const row = (m || [])[0] as { id: string; owner_id: string | null } | undefined;
        if (row && (!row.owner_id || row.owner_id === userId)) {
          await sb.from("merchants").update({ owner_id: userId }).eq("id", row.id);
        }
      }
    } catch {}
    return { email, password, userId };
  }

  // Rider: ensure the riders row exists (don't clobber an existing rider's data).
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

/**
 * Admin → issue (or re-issue) the onboarding password-setup link for an
 * ALREADY approved application whose user was never asked for a password.
 * This is separate from POST /api/admin/password-resets, which is the
 * forgotten-password flow: here the user has NO password yet, and the
 * purpose="onboarding" code lands them on /setup-login where they also
 * send documents (either licence OR owner ID for businesses).
 */
export async function PUT(req: NextRequest) {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || "";
  if (!(await verifySession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.application_id || body.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid application id" }, { status: 400 });
  }

  await ensureTable(sb);
  const { data: application } = await sb.from("partner_requests").select("*").eq("id", id).maybeSingle();
  if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (application.status !== "approved") {
    return NextResponse.json({ error: "Only approved applications can receive a setup link." }, { status: 400 });
  }
  if (!isEmail(String(application.email || ""))) {
    return NextResponse.json({ error: "This application has no valid email to link a login to." }, { status: 400 });
  }

  try {
    const email = String(application.email).toLowerCase().trim();
    const acctRole = application.role === "business" ? "business" : "rider";
    const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let user = (users?.users || []).find((u: any) => String(u.email || "").toLowerCase() === email) || null;
    let userId = user?.id || "";
    if (!user) {
      const placeholder = `Gd!${randomBytes(9).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}A1#`;
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email,
        password: placeholder,
        email_confirm: true,
        user_metadata: {
          name: clamp(application.contact_name, 120) || clamp(application.business_name, 200),
          role: acctRole,
          must_change_password: true,
        },
      });
      if (cErr) throw new Error(cErr.message);
      user = created.user || null;
      userId = user?.id || "";
    }
    if (!userId) throw new Error("Could not provision the login account");

    // Re-link domain row (idempotent)
    if (acctRole === "rider") {
      const { data: row } = await sb.from("riders").select("id").eq("id", userId).maybeSingle();
      if (!row) {
        await sb.from("riders").insert({
          id: userId, name: clamp(application.contact_name, 120), email,
          phone: clamp(application.phone, 40),
          vehicle_type: clamp(application.category, 80) || "motorbike",
          plate: "", service_area: clamp(application.area, 160) || "Uganda",
          lat: 0, lng: 0, status: "offline", verified: false, total_deliveries: 0, rating: 4.5,
        });
      }
    } else {
      try {
        const bizName = clamp(application.business_name, 200);
        if (bizName) {
          const { data: m } = await sb.from("merchants").select("id, owner_id").ilike("name", bizName).limit(1);
          const row = (m || [])[0] as { id: string; owner_id: string | null } | undefined;
          if (row && (!row.owner_id || row.owner_id === userId)) {
            await sb.from("merchants").update({ owner_id: userId }).eq("id", row.id);
          }
        }
      } catch {}
    }

    const { issueResetCode } = await import("@/lib/password-reset-server");
    const issued = await issueResetCode(sb, {
      user_id: userId,
      email,
      name: clamp(application.contact_name, 120) || clamp(application.business_name, 200),
      role: acctRole,
      issued_by: "admin",
      purpose: "onboarding",
      application_id: id,
    });
    if (!issued) return NextResponse.json({ error: "Could not issue the onboarding setup code." }, { status: 500 });
    await sb.from("partner_requests").update({ credentials_issued: true }).eq("id", id);
    return NextResponse.json({
      ok: true,
      onboarding_link: {
        url: `https://godoor.site/setup-login?token=${issued.record.id}`,
        code: issued.code,
        id: issued.record.id,
      },
    });
  } catch (e: any) {
    console.error("[partner-request] onboarding link re-issue failed:", e?.message || e);
    return NextResponse.json({ error: "Could not issue the setup link: " + (e?.message || "unknown error") }, { status: 500 });
  }
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

  // ── Onboarding password-setup link ────────────────────────────────────
  // Purpose-tagged one-time code for an approved business/rider who was
  // never asked for a password. The admin copies link+code and sends it by
  // WhatsApp/SMS. The user opens /setup-login?token=<id>, sets their OWN
  // password there, and then sends documents — no email round-trip needed.
  //
  // This is the real onboarding-credentials path. The old
  // issueRiderCredentials() one-time password meant the helper had to tell
  // the user the password; the link means the user chooses it, so it never
  // travels in the clear.
  let onboardingLink: { url: string; code: string; id: string } | null = null;
  let riderCreds: { email: string; password: string } | null = null;
  let merchantCreated: { id: string } | null = null;
  if (patch.status === "approved" && (application?.role === "rider" || application?.role === "business")) {
    if (!application?.credentials_issued && isEmail(String(application.email || ""))) {
      try {
        // Provision the auth user with a random placeholder (the user
        // replaces it via the setup link). If the user already exists we
        // keep them — we never overwrite a real password here; the link
        // is how they set their own.
        const email = String(application.email).toLowerCase().trim();
        const acctRole = application.role === "business" ? "business" : "rider";
        const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
        let user = (users?.users || []).find((u: any) => String(u.email || "").toLowerCase() === email) || null;
        let userId = user?.id || "";
        if (!user) {
          const placeholder = `Gd!${randomBytes(9).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}A1#`;
          const { data: created, error: cErr } = await sb.auth.admin.createUser({
            email,
            password: placeholder,
            email_confirm: true,
            user_metadata: {
              name: clamp(application.contact_name, 120) || clamp(application.business_name, 200),
              role: acctRole,
              must_change_password: true,
            },
          });
          if (cErr) throw new Error(cErr.message);
          user = created.user || null;
          userId = user?.id || "";
        }
        if (!userId) throw new Error("Could not provision the login account");

        // Link the domain row (riders.id / merchants.owner_id) so the
        // dashboard resolves on first sign-in.
        if (acctRole === "rider") {
          const { data: row } = await sb.from("riders").select("id").eq("id", userId).maybeSingle();
          if (!row) {
            await sb.from("riders").insert({
              id: userId,
              name: clamp(application.contact_name, 120),
              email,
              phone: clamp(application.phone, 40),
              vehicle_type: clamp(application.category, 80) || "motorbike",
              plate: "",
              service_area: clamp(application.area, 160) || "Uganda",
              lat: 0, lng: 0, status: "offline", verified: false,
              total_deliveries: 0, rating: 4.5,
            });
          }
        } else {
          try {
            const bizName = clamp(application.business_name, 200);
            if (bizName) {
              const { data: m } = await sb.from("merchants").select("id, owner_id").ilike("name", bizName).limit(1);
              const row = (m || [])[0] as { id: string; owner_id: string | null } | undefined;
              if (row && (!row.owner_id || row.owner_id === userId)) {
                await sb.from("merchants").update({ owner_id: userId }).eq("id", row.id);
              }
            }
          } catch {}
        }

        const { issueResetCode } = await import("@/lib/password-reset-server");
        const issued = await issueResetCode(sb, {
          user_id: userId,
          email,
          name: clamp(application.contact_name, 120) || clamp(application.business_name, 200),
          role: acctRole,
          issued_by: "admin",
          purpose: "onboarding",
          application_id: id,
        });
        if (!issued) throw new Error("Could not issue the onboarding setup code");
        onboardingLink = {
          url: `https://godoor.site/setup-login?token=${issued.record.id}`,
          code: issued.code,
          id: issued.record.id,
        };
        await sb.from("partner_requests").update({ credentials_issued: true }).eq("id", id);
      } catch (e: any) {
        console.error("[partner-request] onboarding credential issuance failed:", e?.message || e);
        return NextResponse.json(
          { ok: true, error: "Application approved but onboarding link failed. Try Approve again: " + (e?.message || "unknown error") },
          { status: 500 },
        );
      }
    }
  }

  if (patch.status === "approved" && application?.role === "business") {
    // Business approval MUST create the merchant row that /api/merchants
    // returns. It never did — only riders got provisioning — so
    // "approved" businesses never appeared in the catalogue (the reported
    // bug: admin approves, customer sees nothing).
    try {
      const email = String(application.email || "").toLowerCase().trim();
      // Find the auth user if one exists (business may have signed up).
      let ownerId: string | null = null;
      if (email) {
        try {
          const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const foundUser = (data?.users || []).find(
            (u) => String(u.email || "").toLowerCase() === email,
          );
          if (foundUser) ownerId = foundUser.id;
        } catch {}
      }
      // Idempotent: if a merchant already exists for this business name, don't duplicate.
      const bizName = clamp(application.business_name, 200);
      const category = canonicalCategory(String(application.category || ""));
      const existing = await sb
        .from("merchants")
        .select("id")
        .ilike("name", bizName)
        .limit(1);
      if (!existing?.error && existing?.data && existing.data.length > 0) {
        merchantCreated = { id: String(existing.data[0].id) };
      } else {
        const { data: created, error: createErr } = await sb
          .from("merchants")
          .insert({
            name: bizName,
            category,
            tagline: clamp(application.details, 500) || "",
            area: clamp(application.area, 200) || "Uganda",
            district: clamp(application.district, 120) || "Uganda",
            momo_number: clamp(application.phone, 40) || "",
            momo_name: clamp(application.contact_name, 120) || "",
            lat: 0.3533, // placeholder OK — matchCategory/category field is what browse uses
            lng: 32.5822,
            delivery_fee_ugx: 2000,
            rating: 0,
            status: "active",
            verified: true,
            owner_id: ownerId,
            email,
          })
          .select("id")
          .single();
        if (createErr) {
          console.error("[partner-request] merchant creation failed:", createErr.message);
        } else if (created) {
          merchantCreated = { id: String(created.id) };
        }
      }
    } catch (e: any) {
      console.error("[partner-request] business provisioning failed:", e?.message || e);
    }

  }

  if (onboardingLink) {
    return NextResponse.json({
      ok: true,
      onboarding_link: onboardingLink,
      ...(merchantCreated ? { merchant_id: merchantCreated.id } : {}),
    });
  }
  if (riderCreds) {
    return NextResponse.json({
      ok: true,
      credentials: riderCreds,
      ...(merchantCreated ? { merchant_id: merchantCreated.id } : {}),
    });
  }
  if (merchantCreated) {
    return NextResponse.json({ ok: true, merchant_id: merchantCreated.id });
  }
  return NextResponse.json({ ok: true });
}