"use client";

import { getSupabase, IS_SUPABASE } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/* ──────────────────────────────────────────────────────────────────
 *  GoDoor Database Layer
 *
 *  When Supabase is configured + tables exist → reads/writes go to Postgres.
 *  When tables don't exist → transparently falls back to Zustand localStorage
 *  so the app works immediately, then switches to real DB once you run the schema.
 * ────────────────────────────────────────────────────────────────── */

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Types ─────────────────────────────────────────────────────

/** A snapshot of one cart line captured on the order (drives "order again"). */
export type ReorderLine = {
  productId: string;
  merchantId: string;
  name: string;
  unitPriceUgx: number;
  quantity: number;
  bulky?: boolean;
};

export type DBMerchant = {
  id: string;
  owner_id?: string;
  name: string;
  verified?: boolean;
  logo_url?: string;
  category: string;
  /** Structural role of the business: goods (delivery storefront) or clinic (appointments). */
  business_type?: "goods" | "clinic";
  tagline: string;
  area: string;
  district?: string;
  lat: number;
  lng: number;
  momo_number: string;
  momo_name: string;
  opens_at: string;
  closes_at: string;
  delivery_fee_ugx: number;
  rating: number;
  status: "active" | "suspended" | "pending";
  live_location_enabled?: boolean;
  /** Fixed Morse handle of the business (never changed after set — payments go here). */
  morse_tag?: string;
  /** Payment methods this business accepts: subset of cash | momo | morse. */
  accepted_payments?: string[];
  created_at: number;
};

export type DBOrder = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  customer_id?: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  rider_id?: string;
  items: string;
  line_items?: ReorderLine[];
  subtotal_ugx: number;
  delivery_fee_ugx: number;
  service_fee_ugx: number;
  total_ugx: number;
  delivery_address: string;
  customer_lat: number | null;
  customer_lng: number | null;
  status: string;
  payment_method: string;
  payment_confirmed: boolean;
  rider_name?: string | null;
  rider_phone?: string | null;
  notes: string;
  scheduled_for?: number | null;
  medicine_subtotal_ugx?: number;
  medicine_paid?: boolean;
  created_at: number;
  updated_at: number;
};

export type DBPayment = {
  id: string;
  order_id: string;
  merchant_id: string;
  amount_ugx: number;
  method: string;
  screenshot_url: string | null;
  transaction_ref: string;
  status: string;
  submitted_by: string;
  confirmed_by: string | null;
  note: string;
  created_at: number;
  updated_at: number;
};

export type DBChatMessage = {
  id: string;
  order_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  text: string;
  image_url: string | null;
  read: boolean;
  created_at: number;
};

export type DBDispute = {
  id: string;
  order_id: string;
  payment_id: string;
  raised_by: string;
  raised_by_name: string;
  reason: string;
  status: string;
  admin_note: string;
  created_at: number;
  updated_at: number;
};

// ─── Check if Supabase tables exist (cached) ──────────────────
let _tablesExist: boolean | null = null;
let _tablesCheckedAt = 0;
async function tablesExist(): Promise<boolean> {
  const now = Date.now();
  if (_tablesExist !== null && now - _tablesCheckedAt < 60000) return _tablesExist;
  const sb = getSupabase();
  if (!sb) { _tablesExist = false; _tablesCheckedAt = now; return false; }
  const { error } = await sb.from("merchants").select("id", { count: "exact", head: true });
  _tablesExist = !error;
  _tablesCheckedAt = now;
  return _tablesExist;
}

// ─── Public API ────────────────────────────────────────────────

function genId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Local persistence (guaranteed fallback so nothing 404s) ──────
const LOCAL_KEY = "godoor-local-db-v2";

type LocalDB = {
  orders: DBOrder[];
  chat: DBChatMessage[];
  payments: DBPayment[];
  disputes: DBDispute[];
  products: DBProduct[];
  riders: DBRider[];
  merchants: DBMerchant[];
};

function loadLocal(): LocalDB {
  if (typeof window === "undefined") return emptyLocal();
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return emptyLocal();
    const parsed = JSON.parse(raw);
    return {
      orders: parsed.orders || [],
      chat: parsed.chat || [],
      payments: parsed.payments || [],
      disputes: parsed.disputes || [],
      products: parsed.products || [],
      riders: parsed.riders || [],
      merchants: parsed.merchants || [],
    };
  } catch { return emptyLocal(); }
}

function emptyLocal(): LocalDB {
  return { orders: [], chat: [], payments: [], disputes: [], products: [], riders: [], merchants: [] };
}

function saveLocal(db: LocalDB): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(db)); } catch {}
}

function mutateLocal(fn: (db: LocalDB) => LocalDB): LocalDB {
  const db = loadLocal();
  const next = fn(db);
  saveLocal(next);
  return next;
}

function isUuid(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Attach the signed-in user's Supabase token to API calls once auth lands.
 *  A stale/expired token silently turns every server write into a 401, which
 *  used to make orders "succeed" as phantom local-only entries — so refresh
 *  the token before sending whenever it is expired or nearly so. */
export async function apiAuthHeaders(json: boolean): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  try {
    const sb = getSupabase();
    if (!sb) return h;
    let session = (await sb.auth.getSession()).data.session;
    if (session) {
      const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
      const stale = expiresAtMs <= 0 || expiresAtMs - Date.now() < 60_000;
      if (stale) {
        try {
          const { data: refreshed } = await sb.auth.refreshSession();
          session = refreshed.session || null;
        } catch {}
      }
    }
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
  } catch {}
  return h;
}

function normalizeLineItems(row: any): ReorderLine[] {
  const raw = Array.isArray(row.line_items) ? row.line_items : [];
  return raw
    .map((li: Record<string, unknown>) => ({
      productId: String(li.productId ?? li.product_id ?? ""),
      merchantId: String(li.merchantId ?? li.merchant_id ?? row.merchant_id ?? ""),
      name: String(li.name ?? ""),
      unitPriceUgx: Number(li.unitPriceUgx ?? li.unit_price_ugx ?? li.price ?? 0) || 0,
      quantity: Number(li.quantity ?? li.qty ?? 1) || 1,
      bulky: Boolean(li.bulky),
    }))
    .filter((li: ReorderLine) => li.productId && li.name);
}

function dbOrder(row: any): DBOrder {
  return {
    id: row.id, merchant_id: row.merchant_id, merchant_name: row.merchant_name,
    customer_id: row.customer_id, customer_name: row.customer_name || "", customer_email: row.customer_email || "", customer_phone: row.customer_phone || "",
    rider_id: row.rider_id || null, items: typeof row.items === "string" ? row.items : JSON.stringify(row.items || []),
    line_items: normalizeLineItems(row),
    subtotal_ugx: row.subtotal_ugx || 0, delivery_fee_ugx: row.delivery_fee_ugx || 0,
    service_fee_ugx: row.service_fee_ugx || 0, total_ugx: row.total_ugx || 0,
    delivery_address: row.delivery_address || "", customer_lat: row.customer_lat != null ? Number(row.customer_lat) : null, customer_lng: row.customer_lng != null ? Number(row.customer_lng) : null,
    status: row.status || "pending", payment_method: row.payment_method || "momo",
    payment_confirmed: !!row.payment_confirmed, rider_name: row.rider_name || null, rider_phone: row.rider_phone || null,
    notes: row.notes || "", scheduled_for: row.scheduled_for ? new Date(row.scheduled_for).getTime() : null,
    medicine_subtotal_ugx: Number(row.medicine_subtotal_ugx || 0), medicine_paid: !!row.medicine_paid,
    created_at: new Date(row.created_at).getTime(), updated_at: new Date(row.updated_at || row.created_at).getTime(),
  };
}

function localOrderRow(o: DBOrder): Record<string, unknown> {
  return {
    id: o.id, merchant_id: o.merchant_id, merchant_name: o.merchant_name, customer_id: o.customer_id,
    customer_name: o.customer_name, customer_email: o.customer_email, customer_phone: o.customer_phone || "", rider_id: o.rider_id,
    items: o.items, line_items: o.line_items || [], subtotal_ugx: o.subtotal_ugx, delivery_fee_ugx: o.delivery_fee_ugx,
    service_fee_ugx: o.service_fee_ugx, total_ugx: o.total_ugx, delivery_address: o.delivery_address,
    customer_lat: o.customer_lat, customer_lng: o.customer_lng, status: o.status,
    payment_method: o.payment_method, payment_confirmed: o.payment_confirmed,
    rider_name: o.rider_name, rider_phone: o.rider_phone, notes: o.notes,
    scheduled_for: o.scheduled_for ? new Date(o.scheduled_for).toISOString() : null,
    medicine_subtotal_ugx: o.medicine_subtotal_ugx || 0, medicine_paid: !!o.medicine_paid,
    created_at: new Date(o.created_at).toISOString(), updated_at: new Date(o.updated_at).toISOString(),
  };
}

// Rewrite the no-op empty functions to read from local store
function emptyOrders(): DBOrder[] { return loadLocal().orders; }
function emptyChat(): DBChatMessage[] { return loadLocal().chat; }
function emptyPayments(): DBPayment[] { return loadLocal().payments; }
function emptyDisputes(): DBDispute[] { return loadLocal().disputes; }
function emptyMerchants(): DBMerchant[] { return loadLocal().merchants || []; }


// ── Merchants ──────────────────────────────────────────────
function merchantFromRow(row: Record<string, unknown>): DBMerchant {
  return {
    id: row.id as string,
    owner_id: (row.owner_id as string) || "",
    name: (row.name as string) || "",
    verified: Boolean(row.verified) || false,
    logo_url: (row.logo_url as string) || "",
    category: (row.category as string) || "Food",
    business_type: ((row.business_type as string) === "clinic" ? "clinic" : "goods") as DBMerchant["business_type"],
    tagline: (row.tagline as string) || "",
    area: (row.area as string) || "",
    district: (row.district as string) || "",
    lat: Number(row.lat || 0),
    lng: Number(row.lng || 0),
    momo_number: (row.momo_number as string) || "",
    momo_name: (row.momo_name as string) || "",
    opens_at: (row.opens_at as string) || "08:00",
    closes_at: (row.closes_at as string) || "22:00",
    delivery_fee_ugx: Number(row.delivery_fee_ugx || 0),
    rating: Number(row.rating || 0),
    status: ((row.status as string) || "active") as DBMerchant["status"],
    live_location_enabled: Boolean(row.live_location_enabled),
    morse_tag: (row.morse_tag as string) || "",
    accepted_payments: Array.isArray(row.accepted_payments) && (row.accepted_payments as unknown[]).length
      ? (row.accepted_payments as string[])
      : ["cash", "momo", "morse"],
    created_at: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
  };
}

export async function fetchMerchants(): Promise<DBMerchant[]> {
  const merged = new Map<string, DBMerchant>();
  // Server data wins (always fresh). Local is only fallback when server is down.
  // We still store local merchants but don't let them override server data.
  const localMerchants = loadLocal().merchants;
  // Prefer the server API (service-role key) so customers see every active business
  try {
    const res = await fetch("/api/merchants");
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json.merchants)) {
      for (const m of json.merchants) merged.set(m.id, merchantFromRow(m));
    }
  } catch {}
  // Add local merchants that aren't on the server yet (owner's own unsaved changes)
  for (const m of localMerchants) {
    if (!merged.has(m.id)) merged.set(m.id, m);
  }
  // Fallback: direct Supabase read (works when RLS policies allow it)
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("merchants").select("*").eq("status", "active").order("rating", { ascending: false });
      if (!error && data?.length) {
        for (const m of data) merged.set(m.id, merchantFromRow(m));
      }
    }
  } catch {}
  return [...merged.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function fetchMerchantById(id: string): Promise<DBMerchant | undefined> {
  // Always hit DB first — local cache is only a fallback when offline or DB hiccups.
  // The old "return local early" path returned stale data forever (e.g. missing
  // morse_tag if the merchant set it after the first cache write).
  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("merchants").select("*").eq("id", id).single();
      if (data) {
        const m = {
          id: data.id, owner_id: data.owner_id || "", name: data.name, verified: false,
          logo_url: (data.logo_url as string) || "", category: data.category || "Food",
          business_type: ((data.business_type as string) === "clinic" ? "clinic" : "goods"),
          tagline: data.tagline || "", area: data.area || "", district: data.district || "",
          lat: data.lat || 0, lng: data.lng || 0,
          momo_number: data.momo_number || "", momo_name: data.momo_name || "",
          opens_at: data.opens_at || "08:00", closes_at: data.closes_at || "22:00",
          delivery_fee_ugx: data.delivery_fee_ugx || 0, rating: Number(data.rating || 0),
          status: data.status || "active", live_location_enabled: Boolean(data.live_location_enabled), morse_tag: (data.morse_tag as string) || "", accepted_payments: Array.isArray(data.accepted_payments) && (data.accepted_payments as unknown[]).length ? (data.accepted_payments as string[]) : ["cash", "momo", "morse"], created_at: new Date(data.created_at).getTime(),
        } as DBMerchant;
        // Keep local in sync so offline fallback stays fresh
        mutateLocal((s) => {
          const next = s.merchants.filter((x) => x.id !== id);
          return { ...s, merchants: [...next, m] };
        });
        return m;
      }
    }
  } catch {}
  // Offline fallback — return whatever local has
  const local = emptyMerchants().find((m) => m.id === id);
  return local;
}


export async function fetchMerchantByOwnerId(ownerId: string): Promise<DBMerchant | undefined> {
  try {
    const sb = getSupabase();
    if (sb && isUuid(ownerId)) {
      // Always hit DB first — local is only an offline fallback
      const { data } = await sb.from("merchants").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data) {
        const m = {
          id: data.id, owner_id: data.owner_id || "", name: data.name, verified: false,
          logo_url: (data.logo_url as string) || "", category: data.category || "Food",
          business_type: ((data.business_type as string) === "clinic" ? "clinic" : "goods"),
          tagline: data.tagline || "", area: data.area || "", district: data.district || "",
          lat: data.lat || 0, lng: data.lng || 0,
          momo_number: data.momo_number || "", momo_name: data.momo_name || "",
          opens_at: data.opens_at || "08:00", closes_at: data.closes_at || "22:00",
          delivery_fee_ugx: data.delivery_fee_ugx || 0, rating: Number(data.rating || 0),
          status: data.status || "active", live_location_enabled: Boolean(data.live_location_enabled), morse_tag: (data.morse_tag as string) || "", accepted_payments: Array.isArray(data.accepted_payments) && (data.accepted_payments as unknown[]).length ? (data.accepted_payments as string[]) : ["cash", "momo", "morse"], created_at: new Date(data.created_at).getTime(),
        } as DBMerchant;
        mutateLocal((s) => {
          const next = s.merchants.filter((x) => x.id !== m.id);
          return { ...s, merchants: [...next, m] };
        });
        return m;
      }
    }
  } catch {}
  // Fallback: try to claim an unclaimed merchant (null owner_id) — legacy businesses created without auth
  try {
    const sb = getSupabase();
    if (sb && isUuid(ownerId)) {
      const { data: unclaimed } = await sb.from("merchants").select("*").is("owner_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (unclaimed) {
        // Claim it by setting owner_id
        await sb.from("merchants").update({ owner_id: ownerId }).eq("id", unclaimed.id);
        unclaimed.owner_id = ownerId;
        const m = merchantFromRow(unclaimed);
        mutateLocal((s) => {
          if (s.merchants.some((x) => x.id === m.id)) return s;
          return { ...s, merchants: [...s.merchants, m] };
        });
        return m;
      }
    }
  } catch {}
  // Offline fallback — return whatever local has
  const local = emptyMerchants().find((m) => m.owner_id === ownerId);
  return local;
}

export async function createMerchant(m: Omit<DBMerchant, "id" | "created_at">): Promise<DBMerchant> {
  const local: DBMerchant = { ...m, id: genId("merc"), created_at: Date.now() };
  // Prefer the server API so the business also exists in Supabase (visible to all customers)
  try {
    const res = await fetch("/api/merchants", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify(m),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.merchant) {
      const db = merchantFromRow(json.merchant);
      mutateLocal((s) => ({ ...s, merchants: [db, ...s.merchants.filter((x) => x.id !== db.id)] }));
      return db;
    }
    console.error("createMerchant API failed, using local:", json.error);
  } catch (e) { console.error("createMerchant crashed, using local:", e); }

  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("merchants").insert({
        name: m.name, category: m.category, tagline: m.tagline, area: m.area,
        district: m.district || "", lat: m.lat, lng: m.lng, momo_number: m.momo_number,
        momo_name: m.momo_name, opens_at: m.opens_at, closes_at: m.closes_at,
        delivery_fee_ugx: m.delivery_fee_ugx,
        rating: m.rating, status: m.status, owner_id: isUuid(m.owner_id) ? m.owner_id : null,
      }).select().single();
      if (!error && data) {
        const db = merchantFromRow(data);
        mutateLocal((s) => ({ ...s, merchants: [db, ...s.merchants] }));
        return db;
      }
      console.error("createMerchant failed, using local:", error?.message);
    }
  } catch (e) { console.error("createMerchant crashed, using local:", e); }
  mutateLocal((s) => ({ ...s, merchants: [local, ...s.merchants] }));
  return local;
}

export async function updateMerchant(id: string, patch: Partial<DBMerchant>): Promise<void> {
  // Optimistically persist locally — this is what the store page + customer browse rely on
  mutateLocal((s) => ({
    ...s,
    merchants: s.merchants.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }));
  // Persist to Supabase through the server API only. The API applies a strict
  // field whitelist (it strips protected fields like `name` and `morse_tag`
  // server-side), so the client must not second-guess it with a direct write.
  try {
    await fetch("/api/merchants", {
      method: "PUT",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ id, ...patch }),
    });
  } catch {}
}

// ── Orders ─────────────────────────────────────────────────
export async function fetchOrders(filters?: { merchant_id?: string; customer_id?: string; status?: string; customer_email?: string }): Promise<DBOrder[]> {
  // Use API route (service-role) to bypass RLS — pass filters to server
  const merged = new Map<string, DBOrder>();
  let dbOk = false;
  try {
    const params = new URLSearchParams();
    if (filters?.merchant_id) params.set("merchant_id", filters.merchant_id);
    if (filters?.customer_id) params.set("customer_id", filters.customer_id);
    if (filters?.customer_email) params.set("customer_email", filters.customer_email);
    if (filters?.status) params.set("status", filters.status);
    const qs = params.toString();
    const res = await fetch(`/api/orders${qs ? "?" + qs : ""}`, { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json.orders)) {
      dbOk = true;
      for (const o of json.orders) merged.set(o.id, dbOrder(o));
    }
  } catch {}
  // Fallback: direct Supabase client (works if RLS allows it)
  if (!dbOk) {
    try {
      const sb = getSupabase();
      if (sb) {
        let q = sb.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
        if (filters?.merchant_id) q = q.eq("merchant_id", filters.merchant_id);
        if (filters?.customer_id) q = q.eq("customer_id", filters.customer_id);
        if (filters?.customer_email) q = q.eq("customer_email", filters.customer_email);
        if (filters?.status) q = q.eq("status", filters.status);
        const { data, error } = await q;
        if (!error && data?.length) {
          dbOk = true;
          for (const o of data) merged.set(o.id, dbOrder(o));
        } else if (!error) {
          dbOk = true;
        }
      }
    } catch {}
  }

  if (!dbOk) {
    for (const o of emptyOrders()) merged.set(o.id, o);
  } else {
    for (const o of emptyOrders()) {
      if (!isUuid(o.id) && !merged.has(o.id)) merged.set(o.id, o);
    }
  }

  let result = [...merged.values()].sort((a, b) => b.created_at - a.created_at);
  // Client-side filtering for local-only data
  if (filters?.merchant_id && !dbOk) result = result.filter((o) => o.merchant_id === filters.merchant_id);
  if (filters?.customer_id && !dbOk) result = result.filter((o) => o.customer_id === filters.customer_id);
  if (filters?.customer_email && !dbOk) result = result.filter((o) => o.customer_email === filters.customer_email);
  if (filters?.status && !dbOk) result = result.filter((o) => o.status === filters.status);
  return result;
}

export async function fetchOrderById(id: string): Promise<DBOrder | undefined> {
  // Prefer the server API (authenticated) — the browser client may be blocked
  // by RLS for orders the customer does not own from the client's perspective.
  try {
    const res = await fetch(`/api/orders?id=${encodeURIComponent(id)}`, { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json.orders) && json.orders.length > 0) return dbOrder(json.orders[0]);
  } catch {}
  // Fallback: direct Supabase read (works when RLS permits it)
  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("orders").select("*").eq("id", id).single();
      if (data) return dbOrder(data);
    }
  } catch {}
  const local = emptyOrders().find((o) => o.id === id);
  return local || undefined;
}

export async function createOrder(o: Omit<DBOrder, "id" | "created_at" | "updated_at">): Promise<DBOrder> {
  // Use server API route (service-role). FAIL LOUDLY on any error: returning a
  // locally-generated "ord_…" order means the business never receives it and
  // payment proofs get orphaned in the DB. Never simulate success.
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify(o),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.order) {
      const msg = (json && typeof (json as any).error === "string" && (json as any).error) || `Order failed (${res.status})`;
      throw new Error(msg);
    }
    const db = dbOrder(json.order);
    // Cache under the SERVER id and drop any phantom "ord_…" ghosts so local
    // history can never show an order the business never saw.
    mutateLocal((s) => {
      const real = s.orders.filter((x) => isUuid(x.id) && x.id !== db.id);
      return { ...s, orders: [db, ...real] };
    });
    return db;
  } catch (e) {
    console.error("createOrder failed:", e);
    throw e;
  }
}

export async function updateOrder(id: string, patch: Partial<DBOrder>): Promise<void> {
  // Persist to server FIRST (service-role) — only update local on success so UI never shows a phantom "ready" that the server rejected and then snaps back
  try {
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ id, patch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = typeof err.error === "string" && err.error ? err.error : `Update failed (${res.status})`;
      console.error("updateOrder API error:", msg);
      throw new Error(msg);
    }
    // Server confirmed — now sync local cache
    mutateLocal((s) => ({
      ...s,
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch, updated_at: Date.now() } : o)),
    }));
  } catch (e) {
    console.error("updateOrder failed:", e);
    throw e;
  }
}

// ── Payments ───────────────────────────────────────────────
export async function fetchPayments(orderId: string): Promise<DBPayment[]> {
  const merged = new Map<string, DBPayment>();
  for (const p of emptyPayments().filter((x) => x.order_id === orderId)) merged.set(p.id, p);
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("payments").select("*").eq("order_id", orderId).order("created_at", { ascending: false });
      if (!error && data?.length) {
        for (const p of data) merged.set(p.id, { ...p as any, id: p.id, created_at: new Date(p.created_at).getTime(), updated_at: new Date(p.updated_at || p.created_at).getTime() });
      }
    }
  } catch {}
  return [...merged.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function submitPayment(p: Omit<DBPayment, "id" | "created_at" | "updated_at">): Promise<DBPayment> {
  if (!isUuid(p.order_id)) {
    // The order was never persisted — an orphan payment row would be invisible
    // to the business. Surface it instead of silently succeeding.
    throw new Error("This order was never confirmed. Please place the order again.");
  }
  const local: DBPayment = { ...p, id: genId("pay"), created_at: Date.now(), updated_at: Date.now() };
  try {
    const res = await fetch("/api/mutations", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ table: "payments", data: p }),
    });
    const json = await res.json();
    if (res.ok && json.row) {
      const db = { ...json.row, id: json.row.id, created_at: new Date(json.row.created_at).getTime(), updated_at: new Date(json.row.updated_at || json.row.created_at).getTime() } as DBPayment;
      mutateLocal((s) => ({ ...s, payments: [db, ...s.payments] }));
      return db;
    }
    console.error("submitPayment API error:", json.error || res.status);
  } catch (e) { console.error("submitPayment crashed:", e); throw e; }
  throw new Error("Payment submission failed. Check your connection and retry.");
}

export async function updatePayment(id: string, patch: Partial<DBPayment>): Promise<void> {
  mutateLocal((s) => ({
    ...s,
    payments: s.payments.map((p) => (p.id === id ? { ...p, ...patch, updated_at: Date.now() } : p)),
  }));
  try {
    const res = await fetch("/api/mutations", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ table: "payments", id, patch }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); console.error("updatePayment API error:", err.error); }
  } catch (e) { console.error("updatePayment failed:", e); }
}

// ── Chat ───────────────────────────────────────────────────
export async function fetchChat(orderId: string): Promise<DBChatMessage[]> {
  const merged = new Map<string, DBChatMessage>();
  for (const m of emptyChat().filter((x) => x.order_id === orderId)) merged.set(m.id, m);
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("chat_messages").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
      if (!error && data?.length) {
        for (const m of data) merged.set(m.id, { ...m as any, id: m.id, created_at: new Date(m.created_at).getTime() });
      }
    }
  } catch {}
  return [...merged.values()].sort((a, b) => a.created_at - b.created_at);
}

export async function sendChatMessage(m: Omit<DBChatMessage, "id" | "created_at">): Promise<DBChatMessage> {
  if (!isUuid(m.order_id)) {
    // Phantom order (never persisted) — the server would store this message with
    // order_id NULL and chat would never display it again. Fail loud instead.
    console.error("sendChatMessage denied for non-persisted order:", m.order_id);
    throw new Error("This order was never confirmed. Please place the order again.");
  }
  try {
    // Server API forces sender_id / sender_role from the verified session —
    // a user can never post as someone else.
    const res = await fetch("/api/mutations", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ table: "chat_messages", data: m }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.row) {
      const db = { ...json.row, id: json.row.id, created_at: new Date(json.row.created_at).getTime() } as DBChatMessage;
      mutateLocal((s) => ({ ...s, chat: [db, ...s.chat] }));
      return db;
    }
    throw new Error((json && (json as any).error) || `Message failed to send (${res.status}).`);
  } catch (e) {
    console.error("sendChatMessage failed:", e);
    throw e;
  }
}

// ── Disputes ───────────────────────────────────────────────
export async function fetchDisputes(status?: string): Promise<DBDispute[]> {
  const merged = new Map<string, DBDispute>();
  for (const d of emptyDisputes()) merged.set(d.id, d);
  try {
    const sb = getSupabase();
    if (sb) {
      let q = sb.from("disputes").select("*").order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (!error && data?.length) {
        for (const d of data) merged.set(d.id, { ...d as any, id: d.id, created_at: new Date(d.created_at).getTime(), updated_at: new Date(d.updated_at || d.created_at).getTime() });
      }
    }
  } catch {}
  let result = [...merged.values()].sort((a, b) => b.created_at - a.created_at);
  if (status) result = result.filter((x) => x.status === status);
  return result;
}

export async function createDispute(d: Omit<DBDispute, "id" | "created_at" | "updated_at">): Promise<DBDispute> {
  const local: DBDispute = { ...d, id: genId("disp"), created_at: Date.now(), updated_at: Date.now() };
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("disputes").insert({
        order_id: d.order_id, payment_id: d.payment_id || null, raised_by: d.raised_by,
        raised_by_name: d.raised_by_name, reason: d.reason, status: d.status,
      }).select().single();
      if (!error && data) {
        const db = { ...data as any, id: data.id, created_at: new Date(data.created_at).getTime(), updated_at: new Date(data.updated_at || data.created_at).getTime() } as DBDispute;
        mutateLocal((s) => ({ ...s, disputes: [db, ...s.disputes] }));
        return db;
      }
    }
  } catch (e) { console.error("createDispute failed, using local:", e); }
  mutateLocal((s) => ({ ...s, disputes: [local, ...s.disputes] }));
  return local;
}

export async function updateDispute(id: string, patch: Partial<DBDispute>): Promise<void> {
  mutateLocal((s) => ({
    ...s,
    disputes: s.disputes.map((d) => (d.id === id ? { ...d, ...patch, updated_at: Date.now() } : d)),
  }));
  try {
    const sb = getSupabase();
    if (sb && isUuid(id)) {
      await sb.from("disputes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    }
  } catch (e) { console.error("updateDispute failed (kept local):", e); }
}

// ── Rider location ─────────────────────────────────────────
export async function updateRiderLocation(riderId: string, lat: number, lng: number, heading?: number, speed?: number, accuracy?: number): Promise<boolean> {
  // Keep a local copy so the tracking page works offline
  mutateLocal((s) => {
    const riders = s.riders.map((r) => r.id === riderId ? { ...r, lat, lng } : r);
    return { ...s, riders };
  });
  const send = async () => {
    // Use mutations route to upsert rider location in the rider_locations table
    return fetch("/api/mutations", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ action: "upsertRiderLocation", rider_id: riderId, lat, lng, heading: heading || 0, speed: speed || 0, accuracy: accuracy || 0 }),
    });
  };
  try {
    let res = await send();
    // A stale JWT silently 401s — refresh once and retry before giving up.
    if (res.status === 401 || res.status === 403) {
      try { await getSupabase()?.auth.refreshSession(); } catch {}
      res = await send();
    }
    return res.ok;
  } catch (e) {
    console.error("updateRiderLocation failed:", e);
    return false;
  }
}

export async function fetchRiderLocation(riderId: string): Promise<{ lat: number; lng: number; heading?: number | null; accuracy?: number | null } | null> {
  const local = loadLocal().riders.find((r) => r.id === riderId) as (DBRider & { lat?: number; lng?: number }) | undefined;
  if (local?.lat != null && local?.lng != null) return { lat: local.lat, lng: local.lng };
  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("rider_locations").select("lat, lng, heading, accuracy").eq("rider_id", riderId).single();
      if (data) return data;
    }
  } catch {}
  return null;
}

// ── Realtime subscriptions ──────────────────────────────────

// One realtime channel per topic, shared by every subscriber. Subscribing to a
// topic that is already live reuses the channel (no `.on()` after `.subscribe()`,
// which throws) and only fans the update out to each registered callback. The
// channel is torn down when the last callback unsubscribes. This makes duplicate
// subscriptions safe — e.g. one rider carrying two active orders on the business
// dashboard, or an effect re-running before an async removeChannel() settles.
type LiveTopic = { channel: RealtimeChannel; cbs: Set<(msg: unknown) => void> };
const liveTopics = new Map<string, LiveTopic>();

function liveSubscribe<T>(
  topic: string,
  bind: (channel: RealtimeChannel, emit: (msg: T) => void) => RealtimeChannel,
  callback: (msg: T) => void,
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  let entry = liveTopics.get(topic);
  if (!entry) {
    const channel = sb.channel(topic);
    const cbs = new Set<(msg: unknown) => void>();
    bind(channel, (msg) => {
      for (const cb of [...cbs]) cb(msg);
    });
    channel.subscribe();
    entry = { channel, cbs };
    liveTopics.set(topic, entry);
  }
  entry.cbs.add(callback as (msg: unknown) => void);
  return () => {
    const e = liveTopics.get(topic);
    if (!e) return;
    e.cbs.delete(callback as (msg: unknown) => void);
    if (e.cbs.size === 0) {
      liveTopics.delete(topic);
      sb.removeChannel(e.channel);
    }
  };
}

export function subscribeToChat(orderId: string, callback: (msg: DBChatMessage) => void) {
  return liveSubscribe(
    `chat:${orderId}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `order_id=eq.${orderId}` }, (payload) => {
        const m = payload.new as Record<string, unknown>;
        emit({
          id: m.id as string,
          order_id: m.order_id as string,
          sender_id: m.sender_id as string,
          sender_name: m.sender_name as string,
          sender_role: m.sender_role as string,
          text: m.text as string,
          image_url: m.image_url as string | null,
          read: m.read as boolean,
          created_at: new Date(m.created_at as string).getTime(),
        });
      }),
    callback,
  );
}

export function subscribeToOrderStatus(orderId: string, callback: (status: string) => void) {
  return liveSubscribe(
    `order:${orderId}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, (payload) => {
        emit((payload.new as Record<string, unknown>).status as string);
      }),
    callback,
  );
}

/** Subscribe to full order row updates (status, rider, address, etc.) */
export function subscribeToOrder(orderId: string, callback: (order: DBOrder) => void) {
  return liveSubscribe(
    `order-full:${orderId}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, (payload) => {
        emit(dbOrder(payload.new as Record<string, unknown>));
      }),
    callback,
  );
}

/** Listen to new/updated orders for a merchant (business dashboard) */
export function subscribeToMerchantOrders(merchantId: string, callback: (order: DBOrder) => void) {
  return liveSubscribe(
    `merchant-orders:${merchantId}`,
    (channel, emit) =>
      channel
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "orders", filter: `merchant_id=eq.${merchantId}` },
          (payload) => emit(dbOrder(payload.new as Record<string, unknown>)),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "orders", filter: `merchant_id=eq.${merchantId}` },
          (payload) => emit(dbOrder(payload.new as Record<string, unknown>)),
        ),
    callback,
  );
}

/** Listen to all order changes (rider dashboard: available + active orders) */
export function subscribeToAllOrders(callback: (order: DBOrder) => void) {
  return liveSubscribe(
    "all-orders",
    (channel, emit) =>
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
          emit(dbOrder(payload.new as Record<string, unknown>));
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload) => {
          emit(dbOrder(payload.new as Record<string, unknown>));
        }),
    callback,
  );
}

export function subscribeToRiderLocation(riderId: string, callback: (loc: { lat: number; lng: number; heading?: number | null; accuracy?: number | null }) => void) {
  return liveSubscribe(
    `rider-loc:${riderId}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "rider_locations", filter: `rider_id=eq.${riderId}` }, (payload) => {
        const r = payload.new as Record<string, unknown>;
        emit({ lat: r.lat as number, lng: r.lng as number, heading: (r.heading as number) || null, accuracy: (r.accuracy as number) ?? null });
      }),
    callback,
  );
}

// ── Provider (business) live location ──────────────────────
// Businesses whose service travels to the customer's door (makeup, salons,
// mobile mechanics) opt IN to share their GPS. The map pin for the shop stays
// static at the merchant's registered lat/lng; this stream powers the moving
// "on the way to you" marker once sharing is enabled.

export type ProviderLocation = { lat: number; lng: number; heading?: number | null };

export async function updateProviderLocation(merchantId: string, lat: number, lng: number, heading?: number, speed?: number, accuracy?: number): Promise<void> {
  try {
    await fetch("/api/mutations", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ action: "upsertProviderLocation", merchant_id: merchantId, lat, lng, heading: heading || 0, speed: speed || 0, accuracy: accuracy || 0 }),
    });
  } catch (e) { console.error("updateProviderLocation failed:", e); }
}

export async function clearProviderLocation(merchantId: string): Promise<void> {
  try {
    await fetch("/api/mutations", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ action: "clearProviderLocation", merchant_id: merchantId }),
    });
  } catch (e) { console.error("clearProviderLocation failed:", e); }
}

export async function fetchProviderLocation(merchantId: string): Promise<ProviderLocation | null> {
  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("provider_locations").select("lat, lng, heading").eq("provider_id", merchantId).single();
      if (data) return { lat: data.lat as number, lng: data.lng as number, heading: (data.heading as number) || null };
    }
  } catch {}
  return null;
}

export function subscribeToProviderLocation(merchantId: string, callback: (loc: ProviderLocation) => void) {
  return liveSubscribe(
    `provider-loc:${merchantId}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "provider_locations", filter: `provider_id=eq.${merchantId}` }, (payload) => {
        const r = payload.new as Record<string, unknown>;
        emit({ lat: r.lat as number, lng: r.lng as number, heading: (r.heading as number) || null });
      }),
    callback,
  );
}

// ── Boda rides ───────────────────────────────────────────────
export type DBRide = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
  distance_km: number;
  fare_ugx: number;
  service_fee_ugx: number;
  total_ugx: number;
  status: "requested" | "accepted" | "in_progress" | "completed" | "cancelled";
  rider_id: string | null;
  rider_name: string;
  created_at: string;
  updated_at: string;
};

export type RideInput = {
  customer_name?: string;
  customer_phone?: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address?: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address?: string;
};

export async function createRide(input: RideInput): Promise<DBRide> {
  const res = await fetch("/api/rides", {
    method: "POST",
    headers: await apiAuthHeaders(true),
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ride) throw new Error(json.error || "Could not request ride");
  return json.ride as DBRide;
}

export async function fetchMyRides(): Promise<DBRide[]> {
  try {
    const res = await fetch("/api/rides?mine=1", { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.rides) ? (json.rides as DBRide[]) : [];
  } catch {
    return [];
  }
}

export async function fetchDriverRides(): Promise<DBRide[]> {
  try {
    const res = await fetch("/api/rides?driver=1", { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.rides) ? (json.rides as DBRide[]) : [];
  } catch {
    return [];
  }
}

export async function fetchOpenRides(): Promise<DBRide[]> {
  const res = await fetch("/api/rides?open=1", { cache: "no-store", headers: await apiAuthHeaders(false) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Could not load ride requests");
  return Array.isArray(json.rides) ? (json.rides as DBRide[]) : [];
}

export async function fetchRideById(id: string): Promise<DBRide | null> {
  try {
    const res = await fetch(`/api/rides?id=${encodeURIComponent(id)}`, { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.rides) && json.rides[0] ? (json.rides[0] as DBRide) : null;
  } catch {
    return null;
  }
}

export async function rideAction(id: string, action: "accept" | "start" | "complete" | "cancel", extra?: Record<string, unknown>): Promise<DBRide> {
  const res = await fetch("/api/rides", {
    method: "PATCH",
    headers: await apiAuthHeaders(true),
    body: JSON.stringify({ id, action, ...(extra || {}) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ride) throw new Error(json.error || "Action failed");
  return json.ride as DBRide;
}

/** Live ride-request board for boda mode — INSERT + UPDATE from the start. */
export function subscribeToOpenRides(callback: () => void) {
  return liveSubscribe(
    "ride-requests:open",
    (channel, emit) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () => emit(undefined as never)),
    callback,
  );
}

/** Live updates for one ride (customer + rider views). */
export function subscribeToRide(id: string, callback: (ride: DBRide) => void) {
  return liveSubscribe(
    `ride:${id}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "ride_requests", filter: `id=eq.${id}` }, (payload) => {
        emit(payload.new as unknown as DBRide);
      }),
    callback,
  );
}


// ── Clinic queue (appointments) ─────────────────────────────
export type ClinicQueueStatus = "waiting" | "in_consultation" | "done" | "no_show";

export type DBClinicQueue = {
  order_id: string;
  merchant_id: string;
  queue_number: number;
  status: ClinicQueueStatus;
  created_at: number;
};

function clinicQueueFromRow(row: Record<string, unknown>): DBClinicQueue {
  return {
    order_id: String(row.order_id || ""),
    merchant_id: String(row.merchant_id || ""),
    queue_number: Number(row.queue_number || 0),
    status: (row.status as ClinicQueueStatus) || "waiting",
    created_at: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
  };
}

export async function fetchClinicQueue(merchantId: string): Promise<DBClinicQueue[]> {
  try {
    const res = await fetch(`/api/clinic/queue?merchant_id=${encodeURIComponent(merchantId)}`, { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    return (Array.isArray(json.queue) ? json.queue : []).map(clinicQueueFromRow);
  } catch {
    return [];
  }
}

/** Assign the next queue number to an order (clinic owner only). Server-authoritative. */
export async function assignQueueNumber(orderId: string): Promise<DBClinicQueue | null> {
  try {
    const res = await fetch("/api/clinic/queue", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ order_id: orderId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.entry) return null;
    return clinicQueueFromRow(json.entry);
  } catch {
    return null;
  }
}

export async function updateQueueStatus(orderId: string, status: ClinicQueueStatus): Promise<DBClinicQueue | null> {
  try {
    const res = await fetch("/api/clinic/queue", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ order_id: orderId, status }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.entry) return null;
    return clinicQueueFromRow(json.entry);
  } catch {
    return null;
  }
}

export function subscribeToClinicQueue(merchantId: string, callback: (entry: DBClinicQueue) => void) {
  return liveSubscribe(
    `clinic-queue:${merchantId}`,
    (channel, emit) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "clinic_queue", filter: `merchant_id=eq.${merchantId}` }, (payload) => {
        const r = (payload.new || payload.old) as Record<string, unknown>;
        if (r) emit(clinicQueueFromRow(r));
      }),
    callback,
  );
}

// ── Admin: Fee Configuration ────────────────────────────────
export type FeeConfig = {
  id: string;
  delivery_fee_ugx: number;
  service_fee_percent: number;
  service_fee_min_ugx: number;
  service_fee_max_ugx: number;
  min_order_ugx: number;
  free_delivery_threshold_ugx: number;
  rider_commission_percent: number;
  platform_commission_percent: number;
  created_at: number;
  updated_at: number;
};

const DEFAULT_FEES: FeeConfig = {
  id: "default",
  delivery_fee_ugx: 2000,
  service_fee_percent: 5,
  service_fee_min_ugx: 0,
  service_fee_max_ugx: 10000,
  min_order_ugx: 3000,
  free_delivery_threshold_ugx: 25000,
  rider_commission_percent: 80,
  platform_commission_percent: 20,
  created_at: Date.now(),
  updated_at: Date.now(),
};

export async function fetchFeeConfig(): Promise<FeeConfig> {
  try {
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from("fee_config").select("*").eq("id", "default").single();
      if (data) return { ...data, created_at: new Date(data.created_at).getTime(), updated_at: new Date(data.updated_at).getTime() } as FeeConfig;
    }
  } catch {}
  return DEFAULT_FEES;
}

export async function updateFeeConfig(patch: Partial<FeeConfig>): Promise<void> {
  try {
    const sb = getSupabase();
    if (sb) {
      await sb.from("fee_config").upsert({ id: "default", ...patch, updated_at: new Date().toISOString() });
    }
  } catch (e) { console.error("updateFeeConfig failed:", e); }
}

// ── Admin: Merchant approval ────────────────────────────────
async function adminMerchantAction(id: string, action: string, extra?: Record<string, unknown>): Promise<void> {
  // Route through the admin API (HMAC cookie + service-role) so RLS lockdown
  // never breaks the admin dashboard, and actions are server-authorized.
  try {
    const res = await fetch("/api/admin/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...extra }),
    });
    if (!res.ok) console.error(`adminMerchantAction ${action} failed:`, res.status);
  } catch (e) { console.error(`adminMerchantAction ${action} crashed:`, e); }
}

export async function approveMerchant(id: string): Promise<void> {
  mutateLocal((s) => ({ ...s, merchants: s.merchants.map((m) => m.id === id ? { ...m, status: "active" } : m) }));
  await adminMerchantAction(id, "approve");
}

export async function suspendMerchant(id: string): Promise<void> {
  mutateLocal((s) => ({ ...s, merchants: s.merchants.map((m) => m.id === id ? { ...m, status: "suspended" } : m) }));
  await adminMerchantAction(id, "suspend");
}

export async function verifyMerchant(id: string, verified: boolean): Promise<void> {
  mutateLocal((s) => ({ ...s, merchants: s.merchants.map((m) => m.id === id ? { ...m, verified } : m) }));
  await adminMerchantAction(id, "approve", { verified });
}

// ── Admin: Rider management ─────────────────────────────────
export type DBRider = {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicle_type: string;
  plate: string;
  service_area: string;
  status: string;
  verified: boolean;
  total_deliveries: number;
  rating: number;
  lat?: number;
  lng?: number;
  created_at: number;
};

export async function fetchRiders(): Promise<DBRider[]> {
  const merged = new Map<string, DBRider>();
  for (const r of loadLocal().riders) merged.set(r.id, r);
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("riders").select("*").order("created_at", { ascending: false });
      if (!error && data?.length) {
        for (const r of data) {
          merged.set(r.id, {
            id: r.id, name: r.name, email: r.email || "", phone: r.phone || "", vehicle_type: r.vehicle_type || "motorbike",
            plate: r.plate || "", service_area: r.service_area || "Uganda", status: r.status || "online",
            verified: !!r.verified, total_deliveries: r.total_deliveries || 0, rating: Number(r.rating || 4.5),
            created_at: new Date(r.created_at).getTime(),
          });
        }
      }
    }
  } catch {}
  return [...merged.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function verifyRider(id: string, verified: boolean): Promise<void> {
  mutateLocal((s) => ({ ...s, riders: s.riders.map((r) => r.id === id ? { ...r, verified } : r) }));
  try {
    const res = await fetch("/api/mutations", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ table: "riders", id, patch: { verified } }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); console.error("verifyRider API error:", err.error); }
  } catch (e) { console.error("verifyRider failed:", e); }
}

export async function updateRiderStatus(id: string, status: string): Promise<void> {
  mutateLocal((s) => ({ ...s, riders: s.riders.map((r) => r.id === id ? { ...r, status } : r) }));
  try {
    // Write via server (service-role) so RLS never blocks
    const res = await fetch("/api/mutations", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ table: "riders", id, patch: { status } }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); console.error("updateRiderStatus API error:", err.error); }
  } catch (e) { console.error("updateRiderStatus failed:", e); }
}

// ── Store Riders (business-owned courier fleets) ───────────
export type StoreRiderMember = {
  rider_id: string;
  status: "invited" | "active" | "declined" | "removed";
  rate_ugx: number;
  created_at: number;
  on_delivery: boolean;
  rider: {
    name: string;
    phone: string;
    email: string;
    vehicle_type: string;
    online: boolean;
    verified: boolean;
    rating: number;
  };
};

function storeRiderFromRow(row: Record<string, unknown>): StoreRiderMember {
  const r = (row.rider as Record<string, unknown>) || {};
  return {
    rider_id: String(row.rider_id || ""),
    status: ((row.status as string) || "invited") as StoreRiderMember["status"],
    rate_ugx: Number(row.rate_ugx || 0),
    created_at: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
    on_delivery: Boolean(row.on_delivery),
    rider: {
      name: String(r.name || "Rider"),
      phone: String(r.phone || ""),
      email: String(r.email || ""),
      vehicle_type: String(r.vehicle_type || "motorbike"),
      online: Boolean(r.online),
      verified: Boolean(r.verified),
      rating: Number(r.rating || 0),
    },
  };
}

export async function fetchBusinessRiders(merchantId: string): Promise<StoreRiderMember[]> {
  try {
    const res = await fetch(`/api/business/riders?merchant_id=${encodeURIComponent(merchantId)}`, { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    return (Array.isArray(json.riders) ? json.riders : []).map(storeRiderFromRow);
  } catch {
    return [];
  }
}

export async function inviteBusinessRider(merchantId: string, emailOrPhone: string): Promise<{ rider_id: string; name: string }> {
  const res = await fetch("/api/business/riders", {
    method: "POST",
    headers: await apiAuthHeaders(true),
    body: JSON.stringify({ merchant_id: merchantId, email_or_phone: emailOrPhone }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.membership) {
    throw new Error((json && (json.error || json.message)) || `Could not invite rider (${res.status})`);
  }
  return { rider_id: String(json.rider?.rider_id || ""), name: String(json.rider?.name || "") };
}

export async function updateBusinessRider(merchantId: string, riderId: string, action: "remove" | "reinvite" | "rate", rateUgx?: number): Promise<boolean> {
  try {
    const res = await fetch("/api/business/riders", {
      method: "PATCH",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ merchant_id: merchantId, rider_id: riderId, action, rate_ugx: rateUgx }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { console.error("updateBusinessRider:", json.error); return false; }
    return true;
  } catch (e) {
    console.error("updateBusinessRider failed:", e);
    return false;
  }
}

export type RiderAffiliation = {
  merchant_id: string;
  merchant_name: string;
  category: string;
  status: "invited" | "active" | "declined" | "removed";
  rate_ugx: number;
  created_at: number;
};

export async function fetchRiderAffiliations(): Promise<{ memberships: RiderAffiliation[]; active: RiderAffiliation | null; invites: RiderAffiliation[] }> {
  try {
    const res = await fetch("/api/rider/affiliations", { cache: "no-store", headers: await apiAuthHeaders(false) });
    const json = await res.json().catch(() => ({}));
    const map = (rows: unknown[]): RiderAffiliation[] => (Array.isArray(rows) ? rows : []).map((r) => {
      const x = r as Record<string, unknown>;
      return {
        merchant_id: String(x.merchant_id || ""),
        merchant_name: String(x.merchant_name || "Store"),
        category: String(x.category || ""),
        status: ((x.status as string) || "invited") as RiderAffiliation["status"],
        rate_ugx: Number(x.rate_ugx || 0),
        created_at: x.created_at ? new Date(x.created_at as string).getTime() : Date.now(),
      };
    });
    return { memberships: map(json.memberships), active: json.active ? map([json.active])[0] : null, invites: map(json.invites) };
  } catch {
    return { memberships: [], active: null, invites: [] };
  }
}

export async function respondRiderAffiliation(merchantId: string, action: "accept" | "decline"): Promise<boolean> {
  try {
    const res = await fetch("/api/rider/affiliations", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ merchant_id: merchantId, action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { console.error("respondRiderAffiliation:", json.error); return false; }
    return true;
  } catch (e) {
    console.error("respondRiderAffiliation failed:", e);
    return false;
  }
}


export async function upsertRider(rider: Partial<DBRider> & { id?: string }): Promise<DBRider> {
  const local: DBRider = {
    id: rider.id || genId("rider"),
    name: rider.name || "",
    email: rider.email || "",
    phone: rider.phone || "",
    vehicle_type: rider.vehicle_type || "motorbike",
    plate: rider.plate || "",
    service_area: rider.service_area || "Uganda",
    status: "online",
    verified: false,
    total_deliveries: 0,
    rating: 4.5,
    lat: rider.lat,
    lng: rider.lng,
    created_at: Date.now(),
  };
  mutateLocal((s) => {
    const existing = s.riders.filter((r) => r.id !== local.id);
    return { ...s, riders: [local, ...existing] };
  });
  // Also try to sync to Supabase via server API
  try {
    await fetch("/api/riders", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ id: local.id, ...rider }),
    });
  } catch {}
  return local;
}

// ── Admin: User management ──────────────────────────────────
export type DBUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: number;
};

export async function fetchUsers(): Promise<DBUser[]> {
  // Prefer the server API (service-role key) — the anon client cannot list auth users.
  try {
    const res = await fetch("/api/admin/users");
    const json = await res.json().catch(() => ({}));
    if (Array.isArray(json.users)) return json.users as DBUser[];
  } catch {}

  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.auth.admin.listUsers();
      if (!error && data?.users) {
        return data.users.map((u) => ({
          id: u.id,
          email: u.email || "",
          name: (u.user_metadata?.name as string) || "",
          role: (u.user_metadata?.role as string) || "customer",
          created_at: new Date(u.created_at).getTime(),
        }));
      }
    }
  } catch {}
  return [];
}




// ── Products (Supabase) ────────────────────────────────────
export type DBProduct = {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image_url: string;
  images?: string[];
  available: boolean;
  sort_order: number;
  bulky?: boolean;
  /** Clinic services are products with is_service = true (appointments book through the normal cart). */
  is_service?: boolean;
  duration_minutes?: number;
  created_at: number;
};

export async function fetchProducts(merchantId?: string): Promise<DBProduct[]> {
  const merged = new Map<string, DBProduct>();
  const local = loadLocal().products.filter((p) => !merchantId || p.merchant_id === merchantId);
  for (const p of local) merged.set(p.id, p);
  try {
    const url = merchantId ? `/api/products?merchant_id=${merchantId}` : "/api/products";
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    for (const p of (json.products || [])) {
      merged.set(p.id, {
        id: p.id, merchant_id: p.merchant_id, name: p.name, description: p.description || "",
        price: p.price, category: p.category || "Food", image_url: p.image_url || "",
        images: (Array.isArray(p.images) ? p.images : []).concat(p.image_url ? [p.image_url] : []),
        available: p.available !== false, sort_order: p.sort_order || 0,
        bulky: p.bulky === true,
        is_service: p.is_service === true,
        duration_minutes: Number(p.duration_minutes || 0),
        created_at: new Date(p.created_at).getTime(),
      });
    }
  } catch {}
  return [...merged.values()].sort((a, b) => a.sort_order - b.sort_order);
}

export async function saveProduct(product: Omit<DBProduct, "created_at">): Promise<DBProduct | null> {
  const local: DBProduct = { ...product, id: product.id || genId("prod"), created_at: Date.now() };
  mutateLocal((s) => {
    const existing = s.products.filter((p) => p.id !== local.id);
    return { ...s, products: [local, ...existing] };
  });
  try {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: await apiAuthHeaders(true),
      body: JSON.stringify({ ...local, images: local.images || (local.image_url ? [local.image_url] : []) }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.error) { console.error("saveProduct DB:", json.error); return local; }
    if (json.product) {
      const db = { ...json.product, created_at: new Date(json.product.created_at).getTime() } as DBProduct;
      mutateLocal((s) => {
        const existing = s.products.filter((p) => p.id !== db.id);
        return { ...s, products: [db, ...existing] };
      });
      return db;
    }
  } catch (e) { console.error("saveProduct failed (kept local):", e); }
  return local;
}

export async function deleteProduct(id: string): Promise<void> {
  mutateLocal((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }));
  try {
    await fetch(`/api/products?id=${id}`, { method: "DELETE", headers: await apiAuthHeaders(false) });
  } catch {}
}

export async function uploadStorePhoto(file: File, merchantId: string): Promise<string> {
  return uploadFile(file, "store-photos", `stores/${merchantId}/${Date.now()}.${file.name.split(".").pop()}`);
}

/** Generic upload: returns the public URL or "" on failure. */
export async function uploadFile(file: File, bucket: string, path?: string): Promise<string> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("bucket", bucket);
    if (path) fd.append("path", path);
    const res = await fetch("/api/upload", { method: "POST", headers: await apiAuthHeaders(false), body: fd });
    const json = await res.json().catch(() => ({}));
    return json.url || "";
  } catch { return ""; }
}
// ── Verification Documents ─────────────────────────────────
export type VerificationDoc = {
  id: string;
  user_id: string;
  role: "business" | "rider";
  document_type: string;
  file_url: string;
  file_name: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
};

export async function uploadVerificationDoc(
  userId: string,
  role: "business" | "rider",
  docType: string,
  file: File,
): Promise<VerificationDoc | null> {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    // Upload file to Supabase Storage
    const fileName = `${role}/${userId}/${docType}_${Date.now()}.${file.name.split(".").pop()}`;
    const { error: uploadErr } = await sb.storage
      .from("verification")
      .upload(fileName, file, { contentType: file.type, upsert: true });

    if (uploadErr) {
      console.error("Upload error:", uploadErr);
      // Fallback: convert to base64 data URL and store directly
      const dataUrl = await fileToDataUrl(file);
      const { data, error } = await sb.from("verification_documents").insert({
        user_id: userId,
        role,
        document_type: docType,
        file_url: dataUrl,
        file_name: file.name,
        status: "pending",
      }).select().single();

      if (error) { console.error(error); return null; }
      return toVerificationDoc(data);
    }

    // Get public URL
    const { data: urlData } = sb.storage.from("verification").getPublicUrl(fileName);
    const fileUrl = urlData?.publicUrl || "";

    const { data, error } = await sb.from("verification_documents").insert({
      user_id: userId,
      role,
      document_type: docType,
      file_url: fileUrl,
      file_name: file.name,
      status: "pending",
    }).select().single();

    if (error) { console.error(error); return null; }
    return toVerificationDoc(data);
  } catch (e) {
    console.error("Verification upload failed:", e);
    return null;
  }
}

export async function fetchVerificationDocs(userId?: string, role?: string): Promise<VerificationDoc[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    let query = sb.from("verification_documents").select("*").order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    if (role) query = query.eq("role", role);
    const { data, error } = await query;
    if (error || !data) return [];
    return data.map(toVerificationDoc);
  } catch { return []; }
}

export async function updateVerificationStatus(
  docId: string,
  status: "approved" | "rejected",
  adminNote?: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("verification_documents").update({
    status,
    admin_note: adminNote || null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", docId);
}

export async function getUserVerificationStatus(userId: string, email?: string): Promise<"none" | "pending" | "approved" | "rejected"> {
  // Prefer the server API (service-role) so RLS / client auth-token issues never
  // cause a false "none". Falls back to direct reads only if the API is unavailable.
  try {
    const params = new URLSearchParams({ id: userId });
    if (email) params.set("email", email);
    const res = await fetch(`/api/rider/verify?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      const s = json?.status;
      if (["none", "pending", "approved", "rejected"].includes(s)) return s;
    }
  } catch {}
  // Fallback: direct browser-client read (works when client is signed in correctly)
  const sb = getSupabase();
  if (!sb) return "none";
  try {
    const { data: riderRow } = await sb.from("riders").select("verified").eq("id", userId).maybeSingle();
    if (riderRow?.verified) return "approved";
    // Also check by email if provided
    if (email) {
      const { data: riderByEmail } = await sb.from("riders").select("verified").eq("email", email.toLowerCase()).maybeSingle();
      if (riderByEmail?.verified) return "approved";
    }
    const { data: merchantRow } = await sb.from("merchants").select("verified").eq("owner_id", userId).maybeSingle().then((r) => r, () => ({ data: null } as any));
    if (merchantRow?.verified) return "approved";
    const { data, error } = await sb.from("verification_documents")
      .select("status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error || !data?.length) return "none";
    if (data.some((d) => d.status === "approved")) return "approved";
    if (data.some((d) => d.status === "rejected")) return "rejected";
    return "pending";
  } catch { return "none"; }
}

function toVerificationDoc(row: any): VerificationDoc {
  return {
    id: row.id,
    user_id: row.user_id,
    role: row.role,
    document_type: row.document_type,
    file_url: row.file_url,
    file_name: row.file_name || "",
    status: row.status,
    admin_note: row.admin_note,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).getTime() : null,
    created_at: new Date(row.created_at).getTime(),
    updated_at: new Date(row.updated_at).getTime(),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

// ── Update rider profile fields ───────────────────────────
export async function updateRider(patch: Partial<DBRider> & { id: string }): Promise<void> {
  const { id, ...updates } = patch;
  // Update local cache
  mutateLocal((s) => ({
    ...s,
    riders: s.riders.map((r) => r.id === id ? { ...r, ...updates } : r),
  }));
  // Persist to Supabase
  try {
    const res = await fetch("/api/mutations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: "riders", data: { id, ...updates } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("updateRider API error:", err.error);
    }
  } catch (e) {
    console.error("updateRider failed:", e);
  }
  // Also try upsert via rider API
  try {
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("riders").upsert({ id, ...updates });
      if (error) console.error("updateRider DB:", error.message);
    }
  } catch (e) {
    console.error("updateRider DB failed:", e);
  }
}
