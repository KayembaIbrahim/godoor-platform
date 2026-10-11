/**
 * GoDoor table reservations.
 *
 * STORAGE
 * ------
 * Reservations live in `app_settings` — (key text PRIMARY KEY, value jsonb,
 * updated_at). Production DDL is unavailable at deploy time (the Supabase
 * access token cannot reach the live project), so a real `reservations` table
 * is not an option. `app_settings` is already proven in production: the
 * stopover clock, withdrawal queue and P2P transfer ledger all run on it.
 *
 * KEY LAYOUT
 * ----------
 *   gd:booking:<id>     one reservation record
 *   gd:booking:index    { [merchantId]: string[] } — ids, newest first
 *
 * CAPACITY
 * --------
 * A slot's capacity is the number of covers already booked for that
 * merchant/date/time. Seats are checked and written inside a per-slot lock
 * (`gd:booking:lock:<merchantId>:<date>:<time>`) claimed by an INSERT, which
 * the primary key makes atomic. Two people booking the last seat at the same
 * moment cannot both win.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const KEY_PREFIX = "gd:booking:";
const INDEX_KEY = "gd:booking:index";
const LOCK_PREFIX = "gd:booking:lock:";

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export type BookingStatus = "confirmed" | "cancelled" | "completed";

export interface BookingRecord {
  id: string;
  merchantId: string;
  merchantName: string;
  userId: string;
  userName: string;
  userEmail: string;
  /** YYYY-MM-DD, always Africa/Kampala calendar date. */
  date: string;
  /** HH:MM in 24h, always a slot the merchant is open for. */
  time: string;
  guests: number;
  /** Optional deposit in UGX. 0 = free reservation. */
  depositUgx: number;
  status: BookingStatus;
  note: string;
  createdAt: string;
  cancelledAt: string | null;
}

export interface BookingConfig {
  /** Whether the booking feature is visible on the landing page. */
  enabled: boolean;
  /** Hard ceiling on party size, regardless of merchant. */
  maxGuests: number;
  /** Deposit taken per guest, in UGX. 0 = free reservation. */
  depositPerGuestUgx: number;
  /** How far ahead a guest may book. */
  advanceDays: number;
  /** Minimum notice before the slot, in minutes. */
  minNoticeMinutes: number;
}

export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  // Ships OFF. This is a new money-adjacent flow (optional deposits), so
  // turning it on is an operator decision, not a default.
  enabled: false,
  maxGuests: 20,
  depositPerGuestUgx: 0,
  advanceDays: 30,
  minNoticeMinutes: 60,
};

/* ------------------------------------------------------------------ *
 * Pure logic — no I/O, unit-tested directly
 * ------------------------------------------------------------------ */

export function parseHhMm(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatHhMm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface SlotWindow {
  opensAt: string | null;
  closesAt: string | null;
  /** Slot length in minutes. */
  durationMinutes?: number;
}

/**
 * Slots a merchant is open for on a given date.
 *
 * Falls back to a standard dinner window when the merchant has not set
 * hours, so a new restaurant is bookable rather than silently absent.
 */
export function buildSlots(win: SlotWindow, opts: { date: string; now?: Date; minNoticeMinutes?: number }): string[] {
  const open = parseHhMm(win.opensAt) ?? 17 * 60;
  const close = parseHhMm(win.closesAt) ?? 22 * 60;
  const step = win.durationMinutes && win.durationMinutes > 0 ? win.durationMinutes : 30;

  // Last seating must finish by closing, not merely start before it.
  const latest = Math.max(open, close - step);
  const out: string[] = [];
  for (let t = open; t <= latest; t += step) out.push(formatHhMm(t));

  return out;
}

/** Slots still bookable: in the future, past the notice window, and not full. */
export function availableSlots(
  win: SlotWindow,
  opts: {
    date: string;
    now?: Date;
    minNoticeMinutes?: number;
    seatsTaken?: Record<string, number>;
    capacity?: number;
  },
): string[] {
  const all = buildSlots(win, { date: opts.date, minNoticeMinutes: opts.minNoticeMinutes });
  // Slots are Kampala wall-clock, so the clock must be too. Comparing a
  // Kampala slot against raw UTC silently shifts every cut-off by 3 hours.
  const now = kampalaNow(opts.now ?? new Date());
  const today = now.toISOString().slice(0, 10);
  const capacity = opts.capacity && opts.capacity > 0 ? opts.capacity : Infinity;

  return all.filter((slot) => {
    // A past date has nothing to offer.
    if (opts.date < today) return false;
    // Today's earlier slots are past the notice window.
    if (opts.date === today) {
      const cutoff = now.getUTCHours() * 60 + now.getUTCMinutes() + (opts.minNoticeMinutes ?? 0);
      if (parseHhMm(slot)! <= cutoff) return false;
    }
    const taken = opts.seatsTaken?.[slot] ?? 0;
    return taken < capacity;
  });
}

/** Africa/Kampala is UTC+3 with no DST, so a fixed offset is exact. */
export const KAMPALA_OFFSET_MIN = 180;

export function kampalaDate(d: Date = new Date()): string {
  return new Date(d.getTime() + KAMPALA_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

export function kampalaNow(d: Date = new Date()): Date {
  return new Date(d.getTime() + KAMPALA_OFFSET_MIN * 60_000);
}

export function resolveBookingConfig(raw: unknown): BookingConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<BookingConfig>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  };
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_BOOKING_CONFIG.enabled,
    maxGuests: num(o.maxGuests, DEFAULT_BOOKING_CONFIG.maxGuests, 1, 100),
    depositPerGuestUgx: num(o.depositPerGuestUgx, DEFAULT_BOOKING_CONFIG.depositPerGuestUgx, 0, 100_000),
    advanceDays: num(o.advanceDays, DEFAULT_BOOKING_CONFIG.advanceDays, 1, 365),
    minNoticeMinutes: num(o.minNoticeMinutes, DEFAULT_BOOKING_CONFIG.minNoticeMinutes, 0, 10_080),
  };
}

export function bookingDeposit(guests: number, cfg: BookingConfig): number {
  const g = Number.isFinite(guests) ? Math.max(0, Math.trunc(guests)) : 0;
  return Math.max(0, g) * Math.max(0, cfg.depositPerGuestUgx);
}

export interface ValidateArgs {
  merchantName: string;
  date: string;
  time: string;
  guests: number;
  slots: string[];
  now?: Date;
  cfg: BookingConfig;
}

/**
 * Returns null when the booking is acceptable, else a user-facing reason.
 */
export function validateBooking(a: ValidateArgs): string | null {
  const now = kampalaNow(a.now ?? new Date());
  const today = now.toISOString().slice(0, 10);

  if (!a.merchantName) return "Choose a restaurant to book.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return "Choose a valid date.";
  if (a.date < today) return "That date has already passed.";
  if (a.date > addDays(today, a.cfg.advanceDays)) return `Bookings open ${a.cfg.advanceDays} days ahead.`;
  if (!/^\d{2}:\d{2}$/.test(a.time)) return "Choose a valid time.";
  if (!a.slots.includes(a.time)) return "That time slot is no longer available.";

  const g = Number.isFinite(a.guests) ? Math.trunc(a.guests) : 0;
  if (g < 1) return "Add at least one guest.";
  if (g > a.cfg.maxGuests) return `Bookings are limited to ${a.cfg.maxGuests} guests.`;

  if (a.date === today) {
    const cutoff = now.getUTCHours() * 60 + now.getUTCMinutes() + a.cfg.minNoticeMinutes;
    if (parseHhMm(a.time)! <= cutoff) return `Please allow ${a.cfg.minNoticeMinutes} minutes' notice.`;
  }
  return null;
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function newBookingId(): string {
  return `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function bookingReference(id: string): string {
  return `GDR-${id.slice(3, 11).toUpperCase()}`;
}

/** Seats already committed per slot, for the availability grid. */
export function seatsBySlot(records: BookingRecord[], date: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    if (r.date !== date || r.status !== "confirmed") continue;
    out[r.time] = (out[r.time] ?? 0) + Math.max(0, r.guests);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

async function readKv(sb: SupabaseClient, key: string): Promise<unknown> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return data.value ?? null;
}

async function writeKv(sb: SupabaseClient, key: string, value: unknown): Promise<void> {
  await sb.from("app_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

export async function readBookingConfig(sb: SupabaseClient): Promise<BookingConfig> {
  return resolveBookingConfig(await readKv(sb, `${KEY_PREFIX}config`));
}

export async function writeBookingConfig(sb: SupabaseClient, cfg: BookingConfig): Promise<void> {
  await writeKv(sb, `${KEY_PREFIX}config`, cfg);
}

export async function readBooking(sb: SupabaseClient, id: string): Promise<BookingRecord | null> {
  const raw = await readKv(sb, `${KEY_PREFIX}${id}`);
  return (raw as BookingRecord) ?? null;
}

async function readIndex(sb: SupabaseClient): Promise<Record<string, string[]>> {
  const raw = (await readKv(sb, INDEX_KEY)) as Record<string, string[]> | null;
  return raw && typeof raw === "object" ? raw : {};
}

export async function listMerchantBookings(sb: SupabaseClient, merchantId: string): Promise<BookingRecord[]> {
  const ids = (await readIndex(sb))[merchantId] ?? [];
  const rows = await Promise.all(ids.map((id) => readBooking(sb, id)));
  return rows.filter((r): r is BookingRecord => Boolean(r));
}

export async function listUserBookings(sb: SupabaseClient, userId: string): Promise<BookingRecord[]> {
  const index = await readIndex(sb);
  const ids = Object.values(index).flat();
  const rows = await Promise.all(ids.map((id) => readBooking(sb, id)));
  return rows
    .filter((r): r is BookingRecord => r !== null)
    .filter((r) => r.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function indexAdd(sb: SupabaseClient, merchantId: string, id: string): Promise<void> {
  const index = await readIndex(sb);
  const list = index[merchantId] ?? [];
  if (!list.includes(id)) index[merchantId] = [id, ...list];
  await writeKv(sb, INDEX_KEY, index);
}

export async function listAllBookings(sb: SupabaseClient): Promise<BookingRecord[]> {
  const index = await readIndex(sb);
  const ids = Object.values(index).flat();
  const rows = await Promise.all(ids.map((id) => readBooking(sb, id)));
  return rows.filter((r): r is BookingRecord => Boolean(r)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Claim the per-slot lock. `app_settings.key` is a primary key, so a
 * duplicate INSERT fails — that is the atomicity, enforced by Postgres.
 */
export async function claimSlotLock(
  sb: SupabaseClient,
  merchantId: string,
  date: string,
  time: string,
): Promise<boolean> {
  const { error } = await sb.from("app_settings").insert({
    key: `${LOCK_PREFIX}${merchantId}:${date}:${time}`,
    value: { at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
  return !error;
}

export async function releaseSlotLock(
  sb: SupabaseClient,
  merchantId: string,
  date: string,
  time: string,
): Promise<void> {
  await sb.from("app_settings").delete().eq("key", `${LOCK_PREFIX}${merchantId}:${date}:${time}`);
}

export interface SaveBookingArgs {
  rec: BookingRecord;
  /** Skip the seat check when editing status (cancel/complete). */
  skipSeatCheck?: boolean;
  /** Max covers per slot. */
  capacity?: number;
}

export type SaveResult = { ok: true; record: BookingRecord } | { ok: false; error: string };

/**
 * Persists a reservation, re-checking capacity inside the caller's slot lock
 * so a last-seat race cannot double-book.
 */
export async function saveBooking(sb: SupabaseClient, args: SaveBookingArgs): Promise<SaveResult> {
  const rec = args.rec;

  if (!args.skipSeatCheck) {
    const capacity = args.capacity && args.capacity > 0 ? args.capacity : Infinity;
    const existing = await listMerchantBookings(sb, rec.merchantId);
    const taken = seatsBySlot(existing, rec.date)[rec.time] ?? 0;
    if (taken + rec.guests > capacity) {
      return { ok: false, error: "That slot just filled up. Please pick another time." };
    }
  }

  await writeKv(sb, `${KEY_PREFIX}${rec.id}`, rec);
  await indexAdd(sb, rec.merchantId, rec.id);
  return { ok: true, record: rec };
}