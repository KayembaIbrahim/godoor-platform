import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";

/**
 * Server-only auth helpers for the customer-facing API routes.
 * Every route that writes order/business/rider data must verify the caller
 * (either the HMAC admin cookie or a verified Supabase JWT) and enforce
 * ownership of the referenced rows.
 */

export type ApiUser = { id: string; email: string; role?: string };

/** An actor is either the admin (login cookie) or a signed-in Godoor user (JWT). */
export type Actor =
  | { kind: "admin" }
  | { kind: "user"; id: string; email: string; role?: string };

/** True when the request carries a valid admin (HMAC-signed) session cookie. */
export async function isAdminCookieValid(): Promise<boolean> {
  try {
    const jar = await cookies();
    return await verifySession(jar.get(ADMIN_COOKIE)?.value || "");
  } catch {
    return false;
  }
}

/**
 * Resolve the actor for a request: admin cookie first, then Supabase JWT.
 * Returns null when neither is present/valid.
 */
export async function authorize(req: Request): Promise<Actor | null> {
  if (await isAdminCookieValid()) return { kind: "admin" };
  const user = await getApiUser(req);
  if (user) return { kind: "user", ...user };
  return null;
}

export async function getApiUser(req: Request): Promise<ApiUser | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = getServiceClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata || {};
    return { id: data.user.id, email: data.user.email || "", role: typeof meta.role === "string" ? meta.role : undefined };
  } catch {
    return null;
  }
}

export async function requireApiUser(
  req: Request,
): Promise<{ ok: true; user: ApiUser; sb: SupabaseClient } | { ok: false }> {
  const sb = getServiceClient();
  if (!sb) return { ok: false };
  const user = await getApiUser(req);
  if (!user) return { ok: false };
  return { ok: true, user, sb };
}

export function isUuid(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Merchant owned by this user (null if none). */
export async function getMerchantForUser(sb: SupabaseClient, userId: string): Promise<{ id: string } | null> {
  try {
    const { data } = await sb
      .from("merchants")
      .select("id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? { id: (data as { id: string }).id } : null;
  } catch {
    return null;
  }
}

/**
 * Verify a caller may write to this merchant. Owned merchants are locked to
 * their owner; unowned (legacy) merchants are claimed by the first verified
 * editor so old listings created before auth can still be managed.
 */
export async function resolveMerchantWriteAccess(
  sb: SupabaseClient,
  merchantId: string | null | undefined,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(merchantId)) return { ok: false, error: "Business not found" };
  const { data, error } = await sb.from("merchants").select("owner_id").eq("id", merchantId).maybeSingle();
  if (error || !data) return { ok: false, error: "Business not found" };
  const ownerId = (data as { owner_id: string | null }).owner_id;
  if (ownerId && ownerId !== userId) return { ok: false, error: "You do not own this business." };
  if (!ownerId) {
    const claim = await sb.from("merchants").update({ owner_id: userId }).eq("id", merchantId).is("owner_id", null).select("id").maybeSingle();
    if (claim.error) return { ok: false, error: claim.error.message };
  }
  return { ok: true };
}

/**
 * Order status machine. Returns `{ ok: true }` or `{ ok: false, error }`.
 */
export type OrderTransitionContext = {
  order: { id: string; status: string; merchant_id: string | null; rider_id: string | null; customer_id: string | null; customer_email: string | null };
  user: ApiUser;
  merchantIdOfCaller: string | null;
};

const STATUSES = ["pending", "payment_submitted", "payment_confirmed", "preparing", "ready", "rider_assigned", "delivering", "delivered", "medicines_ready", "cancelled"];

export function isKnownStatus(status: unknown): status is string {
  return typeof status === "string" && STATUSES.includes(status);
}

export function canTransition(
  ctx: OrderTransitionContext,
  next: string | null,
  extra: { payment_confirmed_patch?: boolean; riderIdPatch?: string | null; medicine_paid_patch?: boolean },
): { ok: true } | { ok: false; error: string } {
  const { order, user, merchantIdOfCaller } = ctx;
  if (next && next === order.status) return { ok: true }; // idempotent
  if (next && !isKnownStatus(next)) return { ok: false, error: `Unknown status "${next}"` };

  const isCustomer = order.customer_id === user.id || order.customer_email === user.email;
  const isMerchant = Boolean(merchantIdOfCaller) && order.merchant_id === merchantIdOfCaller;
  const isAssignedRider = Boolean(order.rider_id) && order.rider_id === user.id;
  const isAnyRider = Boolean(extra.riderIdPatch) && extra.riderIdPatch === user.id;

  // Cancellation: customer (own) or merchant (own) before assignment
  if (next === "cancelled") {
    if (isCustomer && ["pending", "payment_submitted", "payment_confirmed"].includes(order.status)) return { ok: true };
    if (isMerchant && ["payment_submitted", "payment_confirmed", "preparing", "ready"].includes(order.status)) return { ok: true };
    return { ok: false, error: "You are not allowed to cancel this order." };
  }

  // Customer uploading payment proof: pending → submitted (their own order)
  if (isCustomer && next === "payment_submitted" && order.status === "pending") return { ok: true };

  // Rider claiming an available order
  if (isAnyRider && !order.rider_id && extra.riderIdPatch) {
    if (next === "rider_assigned" && ["payment_confirmed", "preparing", "ready", "medicines_ready"].includes(order.status)) {
      return { ok: true };
    }
  }

  // Merchant lifecycle — permissive so Ready button never mysteriously resets
  if (isMerchant) {
    const before = order.status;
    const valid: Record<string, string[]> = {
      payment_submitted: ["payment_confirmed", "preparing", "ready", "cancelled", "payment_submitted"],
      payment_confirmed: ["preparing", "ready", "cancelled", "payment_confirmed", "medicines_ready"],
      preparing: ["ready", "cancelled", "preparing", "payment_confirmed"],
      ready: ["delivering", "cancelled", "ready", "preparing"],
      medicines_ready: ["payment_confirmed", "preparing", "delivered", "medicines_ready"],
      delivering: ["delivered", "delivering", "ready"],
    };
    if (next && valid[before]?.includes(next)) return { ok: true };
    if (!next && extra.payment_confirmed_patch === true) return { ok: true }; // confirm payment only
    if (!next && extra.medicine_paid_patch === true) return { ok: true };      // confirm medicine payment only
    return { ok: false, error: "This action is not allowed for the order's current status." };
  }

  // Rider lifecycle on assigned order
  if (isAssignedRider || isAnyRider) {
    const valid: Record<string, string[]> = {
      rider_assigned: ["delivering", "delivered", "rider_assigned"],
      delivering: ["delivered", "delivering"],
      ready: ["rider_assigned"],
    };
    if (next && valid[order.status]?.includes(next)) return { ok: true };
    return { ok: false, error: "This action is not allowed for a driver on this order." };
  }

  // Customer: only cancellation handled above
  return { ok: false, error: "You are not authorized to update this order." };
}