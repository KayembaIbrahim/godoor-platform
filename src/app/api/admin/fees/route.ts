import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import { resolveFees, FALLBACK_FEE_CONFIG } from "@/lib/fees";

/**
 * Admin fee configuration. This is the ONLY way the fee row changes — a narrow
 * allowlist of pricing fields rather than a general write surface.
 *
 * The public read used by the cart/checkout lives at GET /api/fees.
 */

const EDITABLE = {
  delivery_fee_ugx: { min: 0, max: 5_000_000 },
  service_fee_percent: { min: 0, max: 100 },
  service_fee_min_ugx: { min: 0, max: 5_000_000 },
  service_fee_max_ugx: { min: 0, max: 100_000_000 },
  min_order_ugx: { min: 0, max: 5_000_000 },
  free_delivery_threshold_ugx: { min: 0, max: 500_000_000 },
  rider_commission_percent: { min: 0, max: 100 },
  platform_commission_percent: { min: 0, max: 100 },
} as const;

type EditableKey = keyof typeof EDITABLE;

export async function GET() {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const { data } = await sb.from("fee_config").select("*").eq("id", "default").maybeSingle();
  return NextResponse.json({ fees: data ?? { ...FALLBACK_FEE_CONFIG, id: "default" } });
}

export async function PATCH(req: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(ADMIN_COOKIE)?.value || ""))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, number> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!(key in EDITABLE)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: `${key} must be a number` }, { status: 400 });
    }
    const { min, max } = EDITABLE[key as EditableKey];
    if (n < min || n > max) {
      return NextResponse.json({ error: `${key} must be between ${min} and ${max}` }, { status: 400 });
    }
    patch[key] = key.endsWith("_percent") ? Math.round(n) : Math.round(n);
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No editable fee fields supplied" }, { status: 400 });
  }

  // Keep the two commission sliders complementary.
  if ("rider_commission_percent" in patch) {
    patch.platform_commission_percent = 100 - patch.rider_commission_percent;
  } else if ("platform_commission_percent" in patch) {
    patch.rider_commission_percent = 100 - patch.platform_commission_percent;
  }

  const { data, error } = await sb
    .from("fee_config")
    .upsert({ id: "default", ...patch, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, fees: data, effective: resolveFees(data) });
}
