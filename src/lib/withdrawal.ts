/**
 * GoDoor withdrawals — customers, riders and businesses cashing GoDoor Pay
 * balances out to their GoDoor Morse wallet.
 *
 * ── Destination is the user's own Morse tag, and only that ──────────────────
 * Money leaves to `@morsetag` on `profiles`. There is no mobile-money rail and
 * no client-supplied destination: the tag is read from the signed-in user's own
 * profile server-side, so a withdrawal can never be directed at someone else's
 * wallet by editing a request body. Topping *up* from mobile money is a
 * different flow (`/api/topup`) and is unaffected.
 *
 * ── Why this is kv-backed and not a table ──────────────────────────────────
 * The obvious design is a `withdrawals` table. Production does not have one:
 * FARE_SCHEMA.sql has never been applied to `llzqkduccdbbetevpoql`, and the
 * workspace Supabase token cannot reach that project (403 database_read), so
 * DDL is not available at deploy time. `app_settings` — (key text PRIMARY KEY,
 * value, updated_at) — *does* exist in production and is only reachable with
 * the service role, so it is the store. WALLET_SECURITY_SCHEMA.sql is provided
 * for when the proper table can be created; nothing here needs to change when
 * it is, because every read and write goes through this module.
 *
 * ── Money safety ───────────────────────────────────────────────────────────
 * There is no `debit_wallet()` RPC in production (the escrow SQL only moves
 * money between available and escrow for an order), so the debit is a
 * read-modify-write. Three things make that safe in practice:
 *
 *   1. A per-user lock row claimed by INSERT. The primary key on
 *      `app_settings.key` means two concurrent withdrawals for one user
 *      cannot both claim it — the loser gets a 409, not a race.
 *   2. The balance is re-read *after* the lock is held, never from a value
 *      read before it.
 *   3. Every movement writes an append-only `ledger_entries` row, so any
 *      disagreement is reconstructable and admin-visible.
 *
 * ── Ledger type ────────────────────────────────────────────────────────────
 * `ledger_entries.type` has a CHECK constraint listing only
 * deposit/order_hold/order_release/commission/payout/refund/adjustment.
 * Writing 'withdrawal' is rejected by Postgres, so movements are recorded as
 * 'adjustment' with ref_type 'withdrawal' — the same convention
 * `mark_payout_paid` already uses.
 *
 * All amounts are integer UGX. No floating-point money math.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MORSE_TAG_RE, normalizeMorseTag as normalizeMorse } from "@/lib/morse";

/* ── Roles ────────────────────────────────────────────────────────────────── */

export type WithdrawalRole = "customer" | "rider" | "business";

export const REC_PREFIX = "withdrawal:rec:";
export const CFG_KEY = "withdrawal:config";
export const USER_PREFIX = "withdrawal:user:";
const LOCK_PREFIX = "withdrawal:lock:";

/* ── Config ───────────────────────────────────────────────────────────────── */

export type WithdrawalConfig = {
  /** Master switch. When false the API refuses and the UI hides. */
  enabled: boolean;
  /** Charged on the customer's own balance. Riders and businesses are paid
   *  in full — they earned that money. */
  customer_fee_percent: number;
  rider_fee_percent: number;
  business_fee_percent: number;
  min_amount_ugx: number;
  max_amount_ugx: number;
  /** Ceiling across all of one user's requests in a UTC day. */
  daily_limit_ugx: number;
  /** Demand a PIN / biometric spend grant before money leaves. */
  require_pin: boolean;
  /** Payout rail. Morse is the only one wired up. */
  destination: "morse";
};

export const FALLBACK_WITHDRAWAL_CONFIG: WithdrawalConfig = {
  enabled: true,
  customer_fee_percent: 2,
  rider_fee_percent: 0,
  business_fee_percent: 0,
  min_amount_ugx: 5000,
  max_amount_ugx: 5_000_000,
  daily_limit_ugx: 2_000_000,
  require_pin: true,
  destination: "morse",
};

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Merge whatever is stored over the defaults, coercing every field. */
export function resolveWithdrawalConfig(raw: unknown): WithdrawalConfig {
  const f = FALLBACK_WITHDRAWAL_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<WithdrawalConfig>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : f.enabled,
    customer_fee_percent: clampInt(r.customer_fee_percent, 0, 50, f.customer_fee_percent),
    rider_fee_percent: clampInt(r.rider_fee_percent, 0, 50, f.rider_fee_percent),
    business_fee_percent: clampInt(r.business_fee_percent, 0, 50, f.business_fee_percent),
    min_amount_ugx: clampInt(r.min_amount_ugx, 0, 10_000_000, f.min_amount_ugx),
    max_amount_ugx: clampInt(r.max_amount_ugx, 1, 100_000_000, f.max_amount_ugx),
    daily_limit_ugx: clampInt(r.daily_limit_ugx, 0, 100_000_000, f.daily_limit_ugx),
    require_pin: typeof r.require_pin === "boolean" ? r.require_pin : f.require_pin,
    destination: "morse",
  };
}

/** Fee percentage for a role, always from the live config. */
export function feePercentFor(role: WithdrawalRole, cfg: WithdrawalConfig): number {
  switch (role) {
    case "rider":
      return cfg.rider_fee_percent;
    case "business":
      return cfg.business_fee_percent;
    default:
      return cfg.customer_fee_percent;
  }
}

/**
 * Split a gross withdrawal into fee and net payout.
 *
 * The fee is a share of the *gross*, so the customer nets
 * `amount * (1 - pct/100)`. Rounded once, half-up, on the fee — then the net
 * is the remainder. Deriving net as `gross - fee` (rather than computing both
 * independently) guarantees fee + net === gross with no lost shilling.
 */
export function splitWithdrawal(
  grossUgx: number,
  role: WithdrawalRole,
  cfg: WithdrawalConfig,
): { gross: number; feePercent: number; fee: number; net: number } {
  const gross = Math.max(0, Math.trunc(grossUgx) || 0);
  const feePercent = feePercentFor(role, cfg);
  const fee = Math.round((gross * feePercent) / 100);
  return { gross, feePercent, fee, net: gross - fee };
}

/* ── Records ──────────────────────────────────────────────────────────────── */

export type WithdrawalStatus = "pending" | "paid" | "cancelled";

export type WithdrawalRecord = {
  id: string;
  userId: string;
  email: string;
  role: WithdrawalRole;
  gross: number;
  fee: number;
  feePercent: number;
  net: number;
  currency: "UGX";
  destination: "morse";
  /**
   * Where admin sends it — the requester's own GoDoor Morse handle, without
   * the leading `@`. Resolved from `profiles.morse_tag`, never from the client.
   */
  morseTag: string;
  /**
   * Only present on records written before the Morse-only rail. Retained so an
   * old request still shows admin where it was headed; never written again.
   */
  msisdn?: string;
  status: WithdrawalStatus;
  reference: string;
  note: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string;
};

/** Human-quotable reference. Not a secret — it appears on the payout receipt. */
export function withdrawalReference(seed = Date.now()): string {
  const tail = Math.floor(Math.random() * 9000) + 1000;
  return `WD-${new Date(seed).toISOString().slice(2, 10).replace(/-/g, "")}-${tail}`;
}

export function newWithdrawalId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `wd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ── Validation ───────────────────────────────────────────────────────────── */

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Normalise a GoDoor Morse handle, or "" when it is not a usable one.
 *
 * Coerces before normalising: `normalizeMorse` calls `.replace` directly, so a
 * record predating the Morse-only rail (no `morseTag` at all) would otherwise
 * throw and take the admin withdrawal queue down with it.
 */
export function normalizeMorseTag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const tag = normalizeMorse(raw);
  return MORSE_TAG_RE.test(tag) ? tag : "";
}

/**
 * Everything that must hold before money moves. Pure, so it is unit-testable
 * without a database — the checks are the security boundary.
 */
export function validateWithdrawal(args: {
  amountUgx: number;
  availableUgx: number;
  alreadyTodayUgx: number;
  morseTag: string;
  cfg: WithdrawalConfig;
}): ValidationResult {
  const { amountUgx, availableUgx, alreadyTodayUgx, morseTag, cfg } = args;
  if (!cfg.enabled) return { ok: false, error: "Withdrawals are temporarily unavailable." };

  const amount = Math.trunc(Number(amountUgx));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid amount in UGX." };
  }
  if (amount % 100 !== 0) {
    return { ok: false, error: "Enter a round amount — no shillings." };
  }
  if (amount < cfg.min_amount_ugx) {
    return { ok: false, error: `Minimum withdrawal is UGX ${cfg.min_amount_ugx.toLocaleString()}.` };
  }
  if (amount > cfg.max_amount_ugx) {
    return { ok: false, error: `Maximum withdrawal is UGX ${cfg.max_amount_ugx.toLocaleString()}.` };
  }
  if (!morseTag) {
    return {
      ok: false,
      error: "Set your GoDoor Morse ID before withdrawing — payouts go to your Morse wallet.",
    };
  }
  if (amount > availableUgx) {
    return {
      ok: false,
      error: `You only have UGX ${Math.max(0, availableUgx).toLocaleString()} available.`,
    };
  }
  if (cfg.daily_limit_ugx > 0 && alreadyTodayUgx + amount > cfg.daily_limit_ugx) {
    const left = Math.max(0, cfg.daily_limit_ugx - alreadyTodayUgx);
    return {
      ok: false,
      error: `Daily limit reached. You can still withdraw UGX ${left.toLocaleString()} today.`,
    };
  }
  return { ok: true };
}

/* ── Store ────────────────────────────────────────────────────────────────── */

function decode<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readKv(sb: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return (data as { value: string | null }).value ?? null;
}

async function writeKv(sb: SupabaseClient, key: string, value: unknown): Promise<{ error: unknown }> {
  const { error } = await sb
    .from("app_settings")
    .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: "key" });
  return { error };
}

export async function readWithdrawalConfig(sb: SupabaseClient): Promise<WithdrawalConfig> {
  return resolveWithdrawalConfig(decode(await readKv(sb, CFG_KEY)));
}

export async function writeWithdrawalConfig(
  sb: SupabaseClient,
  patch: Partial<WithdrawalConfig>,
): Promise<WithdrawalConfig> {
  const current = await readWithdrawalConfig(sb);
  const next = resolveWithdrawalConfig({ ...current, ...patch });
  await writeKv(sb, CFG_KEY, next);
  return next;
}

export async function readWithdrawal(sb: SupabaseClient, id: string): Promise<WithdrawalRecord | null> {
  return decode<WithdrawalRecord>(await readKv(sb, REC_PREFIX + id));
}

export async function saveWithdrawal(sb: SupabaseClient, rec: WithdrawalRecord): Promise<void> {
  await writeKv(sb, REC_PREFIX + rec.id, rec);
}

/** All of one user's requests, newest first. */
export async function listUserWithdrawals(
  sb: SupabaseClient,
  userId: string,
  limit = 25,
): Promise<WithdrawalRecord[]> {
  const raw = decode<WithdrawalRecord[]>(await readKv(sb, USER_PREFIX + userId));
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, limit);
}

/** The whole queue, for the admin console. */
export async function listAllWithdrawals(
  sb: SupabaseClient,
  limit = 100,
): Promise<WithdrawalRecord[]> {
  const { data, error } = await sb
    .from("app_settings")
    .select("key,value")
    .like("key", `${REC_PREFIX}%`)
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  const out: WithdrawalRecord[] = [];
  for (const row of data as Array<{ key: string; value: string }>) {
    const rec = decode<WithdrawalRecord>(row.value);
    if (rec && rec.id) out.push(rec);
  }
  return out.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/** Sum requested today (UTC), for the daily-limit check. Cancelled excluded. */
export function sumRequestedToday(records: WithdrawalRecord[], now = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  return records
    .filter((r) => r.status !== "cancelled" && r.requestedAt.slice(0, 10) === day)
    .reduce((sum, r) => sum + r.gross, 0);
}

/* ── Concurrency lock ─────────────────────────────────────────────────────── */

/**
 * Claim the single withdrawal slot for a user. The primary key on
 * `app_settings.key` is the lock: a duplicate INSERT fails, so two requests
 * from the same account cannot both proceed to the read-modify-write below.
 */
export async function claimWithdrawalLock(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await sb.from("app_settings").insert({
    key: LOCK_PREFIX + userId,
    value: JSON.stringify({ at: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  });
  return !error;
}

export async function releaseWithdrawalLock(sb: SupabaseClient, userId: string): Promise<void> {
  await sb.from("app_settings").delete().eq("key", LOCK_PREFIX + userId);
}

/* ── Role resolution ──────────────────────────────────────────────────────── */

/**
 * Which fee applies.
 *
 * The JWT's `user_metadata.role` is unreliable — it is self-reported at signup
 * and never updated when someone registers a shop or starts driving. The
 * database is the truth: `riders.id` IS the auth user id, and a business is an
 * owner of `merchants`. Someone who both drives and owns a shop is an earner,
 * so either match earns the free rate rather than being charged the customer
 * fee on income they generated.
 */
export async function resolveWithdrawalRole(
  sb: SupabaseClient,
  userId: string,
): Promise<WithdrawalRole> {
  const [rider, merchant] = await Promise.all([
    sb.from("riders").select("id,verified").eq("id", userId).maybeSingle(),
    sb.from("merchants").select("id,owner_id").eq("owner_id", userId).limit(1).maybeSingle(),
  ]);
  const riderOk = !rider.error && !!rider.data;
  const merchantOk = !merchant.error && !!merchant.data;
  if (riderOk || merchantOk) return merchantOk ? "business" : "rider";
  return "customer";
}

/**
 * The signed-in user's own GoDoor Morse handle, without the leading `@`.
 *
 * This is the *only* payout destination: the API resolves it from the actor's
 * own profile row rather than accepting one in the request body, so a customer
 * cannot redirect a withdrawal to another account by editing a payload. Empty
 * string means no usable tag — the user must set one before withdrawing.
 *
 * The service client is required because `profiles` is RLS-protected to the
 * owner, and the lookup has to work for riders and businesses too.
 */
export async function resolveUserMorseTag(
  sb: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await sb
    .from("profiles")
    .select("morse_tag")
    .eq("id", userId)
    .maybeSingle();
  if (error) return "";
  const raw = (data as { morse_tag?: string | null } | null)?.morse_tag ?? "";
  return normalizeMorseTag(raw);
}

/**
 * What admin should read off a record to send the money. Current records carry
 * `morseTag`; pre-Morse ones only have the old `msisdn`, so they still resolve
 * to something instead of rendering blank in the queue.
 *
 * `Partial` because a record read back from the queue genuinely may have
 * neither field — the caller decodes JSON, not a validated `WithdrawalRecord`.
 */
export function withdrawalDestination(
  rec: Partial<Pick<WithdrawalRecord, "morseTag" | "msisdn">>,
): string {
  const tag = normalizeMorseTag(rec.morseTag);
  if (tag) return `@${tag}`;
  const legacy = String(rec.msisdn || "").trim();
  return legacy ? `${legacy} (legacy mobile money)` : "—";
}

/* ── Balance mutation ─────────────────────────────────────────────────────── */

/**
 * Debit the wallet and record the movement.
 *
 * Caller must already hold the per-user lock. The balance is re-read here, so
 * a stale value from before the lock can never be written back.
 *
 * Returns the new balance, or throws with a user-safe message.
 */
export async function debitWallet(
  sb: SupabaseClient,
  userId: string,
  gross: number,
  rec: Pick<WithdrawalRecord, "id" | "fee" | "net" | "role" | "reference" | "morseTag">,
): Promise<number> {
  const { data, error } = await sb
    .from("wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Wallet unavailable");

  const current = Number(
    (data as { available_balance?: number | null } | null)?.available_balance ?? 0,
  );
  if (current < gross) {
    throw new Error(`You only have UGX ${current.toLocaleString()} available.`);
  }

  const next = current - gross;
  const { error: updErr } = await sb
    .from("wallets")
    .update({ available_balance: next })
    .eq("user_id", userId);
  if (updErr) throw new Error("Could not update your wallet");

  // Append-only trail. 'adjustment' is one of the six types the CHECK
  // constraint on ledger_entries.type accepts.
  await sb.from("ledger_entries").insert({
    user_id: userId,
    type: "adjustment",
    amount: -gross,
    currency: "UGX",
    ref_type: "withdrawal",
    ref_id: rec.id,
    meta: {
      role: rec.role,
      fee: rec.fee,
      net: rec.net,
      reference: rec.reference,
      destination: `morse:${rec.morseTag}`,
    },
  });

  return next;
}

/** Give the money back when an admin cancels a request. Idempotent. */
export async function creditWalletRefund(
  sb: SupabaseClient,
  userId: string,
  gross: number,
  rec: Pick<WithdrawalRecord, "id" | "reference">,
): Promise<void> {
  const { data } = await sb
    .from("wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();
  const current = Number((data as { available_balance?: number | null } | null)?.available_balance ?? 0);
  await sb.from("wallets").update({ available_balance: current + gross }).eq("user_id", userId);
  await sb.from("ledger_entries").insert({
    user_id: userId,
    type: "adjustment",
    amount: gross,
    currency: "UGX",
    ref_type: "withdrawal_refund",
    ref_id: rec.id,
    meta: { reference: rec.reference },
  });
}
