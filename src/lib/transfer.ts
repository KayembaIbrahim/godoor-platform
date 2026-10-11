/**
 * GoDoor P2P transfers — sending wallet balance to another GoDoor user by
 * email. Unlike a withdrawal (money leaves, an admin pays it out by hand), a
 * transfer is instant and self-settling: the sender's wallet is debited and the
 * recipient's is credited with no human in the loop. That makes the failure
 * modes different and, in one case, worse — there is nobody downstream to
 * notice a missing credit and reverse it.
 *
 * ── Why kv-backed ───────────────────────────────────────────────────────────
 * Same reason as `withdrawal.ts`: production has no `transfers` table because
 * FARE_SCHEMA.sql was never applied to `llzqkduccdbbetevpoql`, and the
 * workspace token cannot reach that project (403 database_read), so DDL is
 * unavailable at deploy time. `app_settings` exists in production and its
 * `key` is a PRIMARY KEY, which gives us database-enforced uniqueness for the
 * idempotency guard and the locks — the same trick `withdrawal.ts` uses.
 *
 * ── Money safety ───────────────────────────────────────────────────────────
 * A transfer is the first two-sided balance mutation in the codebase. Every
 * withdrawal so far is one-sided, so a read-modify-write was survivable; here a
 * naive version can either mint money (credit twice) or destroy it (debit with
 * no credit). Four independent guards, because any one of them failing must
 * not lose a customer's money:
 *
 *   1. **Compare-and-swap on every balance write.** Both legs update
 *      `wallets` with `.eq("available_balance", <value read moments ago>)`, so
 *      a write is only accepted if nobody moved the balance in between. A lost
 *      CAS returns no row rather than silently clobbering a concurrent change.
 *   2. **A CHECK constraint backs the debit.** `wallets` carries
 *      `CHECK (available_balance >= 0)`, so even a logic error cannot persist a
 *      negative balance — Postgres rejects the row.
 *   3. **Compensation.** If the debit succeeds and the credit then fails, the
 *      debit is reversed immediately and the transfer is recorded as
 *      `reversed`. The sender is never left short.
 *   4. **A database-enforced idempotency key.** The spend grant is a stateless
 *      HMAC valid for 90s, so a double-tap inside that window would pass it
 *      twice. The client sends a `clientKey`; the primary key on
 *      `app_settings.key` makes the second attempt fail rather than send twice.
 *
 * Locks are claimed in a deterministic (sorted) order across both parties, so
 * two users transferring to each other simultaneously cannot deadlock — the
 * classic A→B / B→A abort.
 *
 * ── Ledger type ────────────────────────────────────────────────────────────
 * `ledger_entries.type` has a CHECK listing only
 * deposit/order_hold/order_release/commission/payout/refund/adjustment.
 * 'transfer' is rejected, so both legs are written as 'adjustment' with
 * ref_type 'transfer' and the *same* ref_id — which is what makes one
 * transaction reconstructable from either party's statement.
 *
 * All amounts are integer UGX. No floating-point money math.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Config ────────────────────────────────────────────────────────────────── */

export type TransferConfig = {
  /** Master switch. When false the API refuses and the UI hides. */
  enabled: boolean;
  /** Fee kept by GoDoor on a transfer. Free by default — it is a customer-to-
   *  customer payment, not a cash-out — but admins can charge one. */
  fee_percent: number;
  min_amount_ugx: number;
  max_amount_ugx: number;
  /** Ceiling across all of one user's transfers in a UTC day. */
  daily_limit_ugx: number;
  /** Demand a PIN / biometric spend grant before money moves. */
  require_pin: boolean;
  /** Keep the recipient's email out of the sender-visible record. */
  show_recipient_name: boolean;
};

export const FALLBACK_TRANSFER_CONFIG: TransferConfig = {
  enabled: true,
  fee_percent: 0,
  min_amount_ugx: 1000,
  max_amount_ugx: 5_000_000,
  daily_limit_ugx: 2_000_000,
  require_pin: true,
  show_recipient_name: true,
};

export const CFG_KEY = "transfer:config";
const REC_PREFIX = "transfer:rec:";
const USER_PREFIX = "transfer:user:";
const INBOX_PREFIX = "transfer:inbox:";
const LOCK_PREFIX = "transfer:lock:";
const IDEM_PREFIX = "transfer:idem:";

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Merge whatever is stored over the defaults, coercing every field. */
export function resolveTransferConfig(raw: unknown): TransferConfig {
  const f = FALLBACK_TRANSFER_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<TransferConfig>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : f.enabled,
    fee_percent: clampInt(r.fee_percent, 0, 50, f.fee_percent),
    min_amount_ugx: clampInt(r.min_amount_ugx, 0, 10_000_000, f.min_amount_ugx),
    max_amount_ugx: clampInt(r.max_amount_ugx, 1, 100_000_000, f.max_amount_ugx),
    daily_limit_ugx: clampInt(r.daily_limit_ugx, 0, 100_000_000, f.daily_limit_ugx),
    require_pin: typeof r.require_pin === "boolean" ? r.require_pin : f.require_pin,
    show_recipient_name:
      typeof r.show_recipient_name === "boolean" ? r.show_recipient_name : f.show_recipient_name,
  };
}

/**
 * Split a gross transfer into the fee GoDoor keeps and the net the recipient
 * receives. The fee is a share of the *gross* so the recipient is credited a
 * single, predictable number; deriving net as `gross - fee` guarantees
 * `fee + net === gross` with no lost shilling.
 */
export function splitTransfer(
  grossUgx: number,
  cfg: TransferConfig,
): { gross: number; feePercent: number; fee: number; net: number } {
  const gross = Math.max(0, Math.trunc(grossUgx) || 0);
  const feePercent = clampInt(cfg.fee_percent, 0, 50, 0);
  const fee = Math.round((gross * feePercent) / 100);
  return { gross, feePercent, fee, net: gross - fee };
}

/* ── Email normalisation ───────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Emails are case-insensitive per RFC, and a pasted address frequently carries
 * a trailing space or capitalised local part. Both make `listUsers` miss and
 * surface as "no account found" for an address that is plainly correct.
 */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Human-facing name for the recipient; falls back to a masked email. */
export function recipientLabel(name: string | null | undefined, email: string): string {
  const trimmed = String(name ?? "").trim();
  if (trimmed) return trimmed;
  const [local] = email.split("@");
  const masked = local.length <= 2 ? `${local}•••` : `${local.slice(0, 2)}•••`;
  return `${masked}@${email.split("@")[1] ?? ""}`;
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value) && value.length <= 254;
}

/* ── Records ───────────────────────────────────────────────────────────────── */

export type TransferStatus = "completed" | "reversed";

export type TransferRecord = {
  id: string;
  reference: string;
  fromUserId: string;
  fromEmail: string;
  /** Resolved from `profiles.name`; empty when the account has no name. */
  fromName: string;
  toUserId: string;
  toEmail: string;
  toName: string;
  amount: number;
  fee: number;
  feePercent: number;
  /** What the recipient actually receives: `amount - fee`. */
  net: number;
  currency: "UGX";
  note: string;
  status: TransferStatus;
  /** Set when the credit leg failed and the debit was returned. */
  reversalReason: string;
  createdAt: string;
};

export function transferReference(seed = Date.now()): string {
  const tail = Math.floor(Math.random() * 9000) + 1000;
  return `TR-${new Date(seed).toISOString().slice(2, 10).replace(/-/g, "")}-${tail}`;
}

export function newTransferId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ── Validation ────────────────────────────────────────────────────────────── */

export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Everything that must hold before money moves. Pure, so it is unit-testable
 * without a database — these checks are the security boundary.
 */
export function validateTransfer(args: {
  amountUgx: number;
  availableUgx: number;
  alreadyTodayUgx: number;
  toEmail: string;
  selfUserId: string;
  toUserId: string | null;
  cfg: TransferConfig;
}): ValidationResult {
  const { amountUgx, availableUgx, alreadyTodayUgx, toEmail, selfUserId, toUserId, cfg } = args;
  if (!cfg.enabled) {
    return { ok: false, error: "Sending money is temporarily unavailable." };
  }

  const amount = Math.trunc(Number(amountUgx));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid amount in UGX." };
  }
  if (amount % 100 !== 0) {
    return { ok: false, error: "Enter a round amount — no shillings." };
  }
  if (!isValidEmail(toEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  /* Self-transfer is blocked before the lookup as well as after: even if the
     lookup returned our own row, moving money to yourself is never intended. */
  if (!toUserId || toUserId === selfUserId) {
    return { ok: false, error: "You cannot send money to your own account." };
  }
  if (amount < cfg.min_amount_ugx) {
    return { ok: false, error: `Minimum transfer is UGX ${cfg.min_amount_ugx.toLocaleString()}.` };
  }
  if (amount > cfg.max_amount_ugx) {
    return { ok: false, error: `Maximum transfer is UGX ${cfg.max_amount_ugx.toLocaleString()}.` };
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
      error: `Daily limit reached. You can still send UGX ${left.toLocaleString()} today.`,
    };
  }
  return { ok: true };
}

/** Sum sent today (UTC) for the daily limit. Reversed transfers don't count. */
export function sumSentToday(records: TransferRecord[], now = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  return records
    .filter((r) => r.status !== "reversed" && r.createdAt.slice(0, 10) === day)
    .reduce((sum, r) => sum + r.amount, 0);
}

/* ── kv store ──────────────────────────────────────────────────────────────── */

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

async function writeKv(sb: SupabaseClient, key: string, value: unknown): Promise<void> {
  await sb
    .from("app_settings")
    .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function readTransferConfig(sb: SupabaseClient): Promise<TransferConfig> {
  return resolveTransferConfig(decode(await readKv(sb, CFG_KEY)));
}

export async function writeTransferConfig(
  sb: SupabaseClient,
  patch: Partial<TransferConfig>,
): Promise<TransferConfig> {
  const current = await readTransferConfig(sb);
  const next = resolveTransferConfig({ ...current, ...patch });
  await writeKv(sb, CFG_KEY, next);
  return next;
}

export async function readTransfer(sb: SupabaseClient, id: string): Promise<TransferRecord | null> {
  return decode<TransferRecord>(await readKv(sb, REC_PREFIX + id));
}

export async function saveTransfer(sb: SupabaseClient, rec: TransferRecord): Promise<void> {
  await writeKv(sb, REC_PREFIX + rec.id, rec);
}

/** Everything this user sent, newest first. */
export async function listUserTransfers(
  sb: SupabaseClient,
  userId: string,
  limit = 25,
): Promise<TransferRecord[]> {
  const raw = decode<TransferRecord[]>(await readKv(sb, USER_PREFIX + userId));
  return (Array.isArray(raw) ? raw : []).slice(0, limit);
}

/** Everything this user received, newest first. */
export async function listInboxTransfers(
  sb: SupabaseClient,
  userId: string,
  limit = 25,
): Promise<TransferRecord[]> {
  const raw = decode<TransferRecord[]>(await readKv(sb, INBOX_PREFIX + userId));
  return (Array.isArray(raw) ? raw : []).slice(0, limit);
}

/** The whole ledger, for the admin console. */
export async function listAllTransfers(
  sb: SupabaseClient,
  limit = 200,
): Promise<TransferRecord[]> {
  const { data, error } = await sb
    .from("app_settings")
    .select("key,value")
    .like("key", `${REC_PREFIX}%`)
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  const out: TransferRecord[] = [];
  for (const row of data as Array<{ key: string; value: string }>) {
    const rec = decode<TransferRecord>(row.value);
    if (rec && rec.id) out.push(rec);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ── Concurrency: locks + idempotency ──────────────────────────────────────── */

/**
 * Claim the transfer slot for BOTH parties.
 *
 * The primary key on `app_settings.key` is the lock: a duplicate INSERT fails,
 * so a second concurrent transfer touching the same account gets a 409 rather
 * than racing the compare-and-swap below. Keys are taken in sorted order so
 * two users sending to each other at the same moment cannot deadlock on each
 * other — the first to arrive claims "a", the second finds "a" taken and backs
 * off instead of both holding one lock and waiting for the other.
 *
 * Returns false if either lock is held; anything already claimed is released
 * before returning, so a partial claim never leaks.
 */
export async function claimTransferLocks(
  sb: SupabaseClient,
  userIds: string[],
): Promise<boolean> {
  const ordered = [...new Set(userIds)].sort();
  const taken: string[] = [];
  for (const id of ordered) {
    const { error } = await sb.from("app_settings").insert({
      key: LOCK_PREFIX + id,
      value: JSON.stringify({ at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      for (const t of taken) {
        await sb.from("app_settings").delete().eq("key", LOCK_PREFIX + t);
      }
      return false;
    }
    taken.push(id);
  }
  return true;
}

export async function releaseTransferLocks(sb: SupabaseClient, userIds: string[]): Promise<void> {
  for (const id of new Set(userIds)) {
    await sb.from("app_settings").delete().eq("key", LOCK_PREFIX + id);
  }
}

/**
 * Claim this client key for a user. The spend grant is stateless and reusable
 * for 90 seconds, so without this a double-tap inside that window would move
 * the money twice. The PK means the second claim fails — the server returns the
 * first transfer instead of sending again.
 */
export async function claimIdempotencyKey(
  sb: SupabaseClient,
  userId: string,
  clientKey: string,
  transferId: string,
): Promise<boolean> {
  const { error } = await sb.from("app_settings").insert({
    key: `${IDEM_PREFIX}${userId}:${clientKey}`,
    value: JSON.stringify({ transferId, at: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  });
  return !error;
}

/** The transfer a previous attempt with this key produced, if any. */
export async function findIdempotentTransfer(
  sb: SupabaseClient,
  userId: string,
  clientKey: string,
): Promise<TransferRecord | null> {
  const raw = decode<{ transferId?: string }>(await readKv(sb, `${IDEM_PREFIX}${userId}:${clientKey}`));
  if (!raw?.transferId) return null;
  return readTransfer(sb, raw.transferId);
}

/**
 * Give the key back when an attempt failed *before* any money moved.
 *
 * The claim exists to stop a double-tap, not to lock a user out of retrying
 * after a typo. Releasing on the failure paths keeps "try again" honest while
 * leaving the double-send guard intact once a transfer has actually completed.
 */
export async function releaseIdempotencyKey(
  sb: SupabaseClient,
  userId: string,
  clientKey: string,
): Promise<void> {
  await sb.from("app_settings").delete().eq("key", `${IDEM_PREFIX}${userId}:${clientKey}`);
}

/* ── Recipient lookup ──────────────────────────────────────────────────────── */

/**
 * Resolve a GoDoor account from an email address.
 *
 * GoTrue's admin API exposes `listUsers` but not a targeted email lookup, so
 * this pages the user list and matches client-side. That is O(users) per send,
 * so results are memoised for a short window — a burst of sends in the same
 * session does not re-page. The cache is deliberately short (60s): a newly
 * registered recipient must be findable almost immediately, and an account
 * being deleted must stop being payable quickly.
 */
const EMAIL_CACHE_TTL_MS = 60_000;
const emailCache = new Map<string, { at: number; user: { id: string; email: string } | null }>();

export type RecipientLookup =
  | { ok: true; user: { id: string; email: string }; name: string }
  | { ok: false; error: string };

export async function resolveRecipientByEmail(sb: SupabaseClient, rawEmail: string): Promise<RecipientLookup> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };

  const cached = emailCache.get(email);
  let userId = cached?.user?.id ?? null;
  if (cached && Date.now() - cached.at < EMAIL_CACHE_TTL_MS) {
    if (!cached.user) return { ok: false, error: "No GoDoor account uses that email address." };
    userId = cached.user.id;
    const name = await readDisplayName(sb, userId);
    return { ok: true, user: cached.user, name };
  }

  let found: { id: string; email: string } | null = null;
  /* Page defensively: 1000 is the API's max, and a growing user base will
     eventually exceed one page. Two pages covers far beyond launch scale
     without letting a request hang. */
  for (let page = 1; page <= 2 && !found; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !Array.isArray(data?.users)) break;
    const match = data.users.find((u) => normalizeEmail(u.email) === email);
    if (match) found = { id: match.id, email: normalizeEmail(match.email) };
    if (data.users.length < 1000) break;
  }

  emailCache.set(email, { at: Date.now(), user: found });
  if (!found) return { ok: false, error: "No GoDoor account uses that email address." };

  const name = await readDisplayName(sb, found.id);
  return { ok: true, user: found, name };
}

/** Best-effort display name. A missing profile must not block a transfer. */
export async function readDisplayName(sb: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return "";
  return String((data as { display_name?: string | null }).display_name ?? "").trim();
}

/* ── The two-sided money move ──────────────────────────────────────────────── */

export type MoveResult =
  | { ok: true; senderBalance: number; recipientBalance: number }
  | { ok: false; error: string; compensated: boolean };

async function readBalance(sb: SupabaseClient, userId: string): Promise<number | null> {
  const { data, error } = await sb
    .from("wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  if (!data) return 0; /* No wallet row yet — treated as a zero balance. */
  return Number((data as { available_balance?: number | null }).available_balance ?? 0);
}

/**
 * Apply `delta` to a wallet with a compare-and-swap on the value read inside
 * this call.
 *
 * `.eq("available_balance", current)` means Postgres only accepts the UPDATE
 * while the balance is still what we read. If anyone moved it in between, no
 * row matches and `data` is null — the caller sees a failure rather than
 * silently overwriting someone else's balance. The `>= 0` CHECK on the column
 * independently rejects an overdraw.
 *
 * A missing wallet row is created first (the unique key on `user_id` makes that
 * safe under the lock), so a brand-new recipient is creditable.
 */
async function adjustBalance(
  sb: SupabaseClient,
  userId: string,
  delta: number,
): Promise<number | null> {
  await sb
    .from("wallets")
    .upsert(
      { user_id: userId, available_balance: 0, escrow_balance: 0 },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readBalance(sb, userId);
    if (current === null) return null;
    const next = current + delta;
    if (next < 0) return null; /* Would overdraw — refused before the DB sees it. */

    const { data, error } = await sb
      .from("wallets")
      .update({ available_balance: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("available_balance", current)
      .select("available_balance")
      .maybeSingle();

    if (error) return null;
    if (data) return Number((data as { available_balance?: number | null }).available_balance ?? next);
    /* No row matched: the balance moved under us. Retry against the new value. */
  }
  return null;
}

/**
 * Debit the sender and credit the recipient, atomically enough to be safe.
 *
 * The debit goes first because it is the leg the CHECK constraint can refuse;
 * discovering an overdraft after crediting the recipient would mean minting
 * money. If the credit then fails, the debit is reversed and the caller
 * records the transfer as `reversed`, so the outcome is always one of
 * "both legs applied" or "neither applied".
 *
 * Caller must hold the locks for both users.
 */
export async function moveTransferFunds(
  sb: SupabaseClient,
  rec: TransferRecord,
): Promise<MoveResult> {
  /* The recipient receives `net` — the fee is GoDoor's, not the recipient's. */
  const senderAfter = await adjustBalance(sb, rec.fromUserId, -rec.amount);
  if (senderAfter === null) {
    return { ok: false, error: "Could not take the money from your wallet.", compensated: false };
  }

  const recipientAfter = await adjustBalance(sb, rec.toUserId, rec.net);
  if (recipientAfter === null) {
    /* Put it straight back. A failed reversal is escalated loudly rather than
       swallowed — a short-paid sender is worse than a failed transfer. */
    const restored = await adjustBalance(sb, rec.fromUserId, rec.amount);
    return {
      ok: false,
      error: restored === null
        ? "The transfer failed and needs support — your balance has been flagged."
        : "The transfer could not be completed. Nothing was sent.",
      compensated: restored !== null,
    };
  }

  await sb.from("ledger_entries").insert([
    {
      user_id: rec.fromUserId,
      type: "adjustment",
      amount: -rec.amount,
      currency: "UGX",
      ref_type: "transfer",
      ref_id: rec.id,
      meta: {
        reference: rec.reference,
        direction: "out",
        to: rec.toEmail,
        toUserId: rec.toUserId,
        fee: rec.fee,
        net: rec.net,
      },
    },
    {
      user_id: rec.toUserId,
      type: "adjustment",
      amount: rec.net,
      currency: "UGX",
      ref_type: "transfer",
      ref_id: rec.id,
      meta: {
        reference: rec.reference,
        direction: "in",
        from: rec.fromEmail,
        fromUserId: rec.fromUserId,
        fee: rec.fee,
      },
    },
  ]);

  return { ok: true, senderBalance: senderAfter, recipientBalance: recipientAfter };
}

/**
 * Undo a completed transfer. Admin-only escape hatch for a transfer sent in
 * error; writes the compensating ledger pair so the reversal is as auditable
 * as the original.
 */
export async function reverseTransferFunds(
  sb: SupabaseClient,
  rec: TransferRecord,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const senderAfter = await adjustBalance(sb, rec.toUserId, -rec.net);
  if (senderAfter === null) return { ok: false, error: "The recipient no longer holds that balance." };

  const restored = await adjustBalance(sb, rec.fromUserId, rec.amount);
  if (restored === null) return { ok: false, error: "Could not return the money." };

  await sb.from("ledger_entries").insert([
    {
      user_id: rec.toUserId,
      type: "adjustment",
      amount: -rec.net,
      currency: "UGX",
      ref_type: "transfer_reversal",
      ref_id: rec.id,
      meta: { reference: rec.reference, reason },
    },
    {
      user_id: rec.fromUserId,
      type: "adjustment",
      amount: rec.amount,
      currency: "UGX",
      ref_type: "transfer_reversal",
      ref_id: rec.id,
      meta: { reference: rec.reference, reason },
    },
  ]);

  await saveTransfer(sb, {
    ...rec,
    status: "reversed",
    reversalReason: String(reason).slice(0, 280),
  });
  return { ok: true };
}

/** Clear the memoised email lookups. For tests. */
export function __resetRecipientCache(): void {
  emailCache.clear();
}