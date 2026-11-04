/**
 * GoDoor escrow core.
 *
 * Every balance change goes through the DB functions (confirm_deposit,
 * hold_escrow, release_escrow, refund_escrow) so the ledger is written
 * atomically with the balance update — no silent edits, no double-credits.
 *
 * All amounts are integers (UGX whole units). No floating-point money math.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_FEE_PERCENT,
  CUSTOMER_SERVICE_FEE_PERCENT,
  RIDER_FEE_PERCENT,
} from "@/lib/fees";

export type DepositProvider = "morse" | "momo" | "blipply" | "manual";
export type DepositStatus = "pending" | "confirmed" | "failed" | "expired" | "cancelled";
export type EscrowStatus = "held" | "released" | "refunded";

export type Deposit = {
  id: string;
  user_id: string;
  provider: DepositProvider;
  provider_ref: string | null;
  amount: number;
  currency: string;
  status: DepositStatus;
  reference_code: string;
  metadata: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
};

export type EscrowHold = {
  id: string;
  order_id: string;
  amount: number;
  status: EscrowStatus;
  created_at: string;
  updated_at: string;
};

export type Wallet = {
  user_id: string;
  available_balance: number;
  escrow_balance: number;
};

export type LedgerEntry = {
  id: string;
  user_id: string;
  type: "deposit" | "order_hold" | "order_release" | "commission" | "rider_payout" | "refund";
  amount: number;
  currency: string;
  ref_type: string | null;
  ref_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

// ── Config ──────────────────────────────────────────────────────────

export {
  CUSTOMER_SERVICE_FEE_PERCENT,
  BUSINESS_FEE_PERCENT,
  RIDER_FEE_PERCENT,
} from "@/lib/fees";
export const DEPOSIT_PENDING_EXPIRY_HOURS = Number(process.env.DEPOSIT_PENDING_EXPIRY_HOURS || 12);
export const GODOR_MORSE_USERNAME = process.env.GODOR_MORSE_USERNAME || "@Godoor";

// ── Reference codes ─────────────────────────────────────────────────

export function generateReferenceCode(): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `GD-${rand}`;
}

// ── Deposits ────────────────────────────────────────────────────────

export async function createDeposit(
  sb: SupabaseClient,
  input: {
    userId: string;
    provider: DepositProvider;
    amount: number;
    currency?: string;
    referenceCode?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Deposit> {
  const referenceCode = input.referenceCode || generateReferenceCode();
  const { data, error } = await sb.from("deposits").insert({
    user_id: input.userId,
    provider: input.provider,
    amount: Math.round(input.amount),
    currency: input.currency || "UGX",
    status: "pending",
    reference_code: referenceCode,
    metadata: input.metadata || {},
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Deposit;
}

export async function getDepositByReference(
  sb: SupabaseClient,
  referenceCode: string,
): Promise<Deposit | null> {
  const { data } = await sb.from("deposits").select("*").eq("reference_code", referenceCode).maybeSingle();
  return data as Deposit | null;
}

export async function getDepositById(
  sb: SupabaseClient,
  depositId: string,
): Promise<Deposit | null> {
  const { data } = await sb.from("deposits").select("*").eq("id", depositId).maybeSingle();
  return data as Deposit | null;
}

export async function listPendingDeposits(sb: SupabaseClient): Promise<Deposit[]> {
  const { data } = await sb.from("deposits").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(100);
  return (data || []) as Deposit[];
}

/**
 * Settled deposits — the ones an admin has already approved.
 *
 * The admin wallet portal used to list ONLY pending deposits, so the moment
 * a credit was approved the row disappeared with no trace of it. That is the
 * opposite of what an escrow ledger should do: an approved credit has to
 * stay visible, with the time it was approved.
 *
 * Returns deposits whose status is no longer `pending` (confirmed, failed,
 * expired or cancelled), newest first.
 */
export async function listSettledDeposits(
  sb: SupabaseClient,
  limit = 100,
): Promise<Deposit[]> {
  const { data } = await sb
    .from("deposits")
    .select("*")
    .neq("status", "pending")
    .order("confirmed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data || []) as Deposit[];
}

/**
 * The whole escrow ledger, newest first — every money movement the platform
 * has recorded, across every user.
 *
 * The customer-facing ledger (`getLedger`) filters to one account; an admin
 * auditing the escrow needs the platform-wide view, where a credit approval
 * can be read next to the refunds, payouts and transfers it funded.
 */
export async function listLedger(
  sb: SupabaseClient,
  options: { limit?: number; userId?: string; type?: string } = {},
): Promise<LedgerEntry[]> {
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  let query = sb
    .from("ledger_entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.type) query = query.eq("type", options.type);
  const { data } = await query;
  return (data || []) as LedgerEntry[];
}

export async function confirmDeposit(
  sb: SupabaseClient,
  depositId: string,
  providerTxId?: string,
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await sb.rpc("confirm_deposit", {
    p_deposit_id: depositId,
    p_provider_tx_id: providerTxId || null,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ success: boolean; message: string }>)[0];
  return row || { success: false, message: "No result" };
}

export async function expireOldDeposits(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - DEPOSIT_PENDING_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb.from("deposits")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .select("id");
  if (error) return 0;
  return (data || []).length;
}

// ── Escrow ──────────────────────────────────────────────────────────

/**
 * Finds and releases orphaned escrow holds — rows in escrow_holds whose
 * associated order does not exist (deleted, never created, or gone). Such
 * rows slip through ordinary cancel/release flows because a handler reads the
 * row before the order is removed, and then the order disappears without ever
 * calling refundEscrow on the hold. Refunding them is safe-by-default (only a
 * nullable merchant_id changes back to null — merchants that never held escrow
 * keep their merchant_id), so a short cleanup on every signup and login sweep
 * makes the ledger stay honest without touching a valid hold.
 */
/**
 * Settle one held row whose order is gone (deleted) or terminal (delivered/
 * cancelled) without having been released/refunded by the normal flow.
 *
 * Two defects made the old helper a no-op for orphaned holds:
 *   1. The caller passed `order?.customer_id`, but the order by definition no
 *      longer exists, so customerId was always undefined and every refund was
 *      skipped — escrow_balance stayed phantom forever.
 *   2. The update used template-string arithmetic ("escrow_balance - 5000"),
 *      which PostgREST treats as a literal value/string, not an expression.
 *
 * Fix: the UPDATE is driven by the hold id only (status='held' guard), and
 * the wallet is credited via the SECURITY DEFINER RPC `credit_wallet_currency`
 * when we know the owner. When the owner is truly unknown (order gone and
 * hold has no customer), we still flip the hold to refunded and surface the
 * drift; the caller re-derives escrow_balance from wallet math instead of
 * trusting a template string.
 */
async function settleHeldRow(
  sb: SupabaseClient,
  holdId: string,
  orderId: string,
  amount: number,
  customerId?: string | null,
  targetStatus: "refunded" | "released" = "refunded",
): Promise<void> {
  // Flip exactly this row while still held (idempotent; second call is a no-op).
  await sb
    .from("escrow_holds")
    .update({ status: targetStatus, updated_at: new Date().toISOString() })
    .eq("id", holdId)
    .eq("status", "held");

  if (!customerId) return;

  // Credit via the audited RPC (never a template string, never a raw update
  // with a string expression). For a terminal delivered order that was never
  // released, releasing via RPC `release_escrow` is the business-right path —
  // but that is driven by the order lifecycle elsewhere. Cleanup is the safety
  // net: it refunds the full held amount to available. Idempotent-ish: the
  // status flip above prevents double-counting on re-runs.
  if (targetStatus === "refunded") {
    const { error } = await sb.rpc("credit_wallet_currency", {
      p_user_id: customerId,
      p_amount: Math.round(amount),
      p_currency: "UGX",
      p_reference: `escrow-cleanup:${orderId}`,
      p_note: "Escrow cleanup — refunded orphaned/terminal hold",
      p_meta: { related_id: orderId, source: "escrow_cleanup" },
    });
    if (error) {
      console.error(`[escrow] cleanup refund failed for hold ${holdId}:`, error.message);
      return;
    }
  }
}

/**
 * Clean every held escrow row whose order is terminal (delivered / cancelled /
 * failed) or deleted, and reconcile phantom escrow balances.
 *
 * Why this exists: the previous cleanup only handled *deleted* orders, and
 * then only via `updateWalletForRefundedHold` which was a no-op for orphans
 * (customerId always undefined, template-string math). Now:
 *  - Holds tied to delivered/cancelled orders that were never released/refunded
 *    are settled (released for delivered, refunded for cancelled/failed).
 *  - Holds tied to deleted orders are refunded (flip status + RPC credit).
 *  - After settling, every wallet's escrow_balance is RE-DERIVED from the
 *    live held rows joined to active orders, instead of trusting the stored
 *    counter — so a phantom "In escrow" number with no live order is cleared.
 */
export async function cleanOrphanedEscrowHolds(sb: SupabaseClient): Promise<number> {
  try {
    const { data: holds, error: holdsError } = await sb
      .from("escrow_holds")
      .select("id, order_id, amount")
      .eq("status", "held");
    if (holdsError || !holds || holds.length === 0) {
      // No held rows at all — still reconcile stored counters below.
      await reconcileEscrowBalances(sb);
      return 0;
    }

    const orderIds = [...new Set(holds.map((h) => h.order_id).filter(Boolean))];
    const orderMap = new Map<string, { id: string; customer_id?: string | null; status?: string }>();
    if (orderIds.length > 0) {
      const { data: orders, error: ordersError } = await sb
        .from("orders")
        .select("id, customer_id, status")
        .in("id", orderIds);
      if (!ordersError) {
        for (const o of orders || []) orderMap.set(o.id, o);
      }
    }

    let settled = 0;
    for (const hold of holds) {
      const order = orderMap.get(hold.order_id);
      const status = order?.status || "missing";
      if (status === "delivered") {
        await settleHeldRow(sb, hold.id, hold.order_id, hold.amount, order?.customer_id, "released");
        settled += 1;
      } else if (status === "cancelled" || status === "failed" || status === "missing") {
        // Deleted or terminal-cancelled order: refund the owner if known.
        await settleHeldRow(sb, hold.id, hold.order_id, hold.amount, order?.customer_id, "refunded");
        settled += 1;
      }
      // Anything else (active/preparing/delivering/rider_assigned, etc.) is a
      // live order — leave the hold untouched.
    }

    await reconcileEscrowBalances(sb);
    return settled;
  } catch (e) {
    console.error("[escrow] cleanOrphanedEscrowHolds failed:", e);
    return 0;
  }
}

/**
 * Re-derive each wallet's escrow_balance from wallet math: the sum of held rows
 * joined to orders whose status is still live (not delivered/cancelled/failed
 * and not deleted). When the derived value differs from the stored counter,
 * it is written back — this clears phantom "In escrow" figures shown to the
 * customer. Available balance is left alone here; settled holds already went
 * through the audited RPCs.
 */
async function reconcileEscrowBalances(sb: SupabaseClient): Promise<void> {
  // Live held rows only.
  const { data: liveHolds } = await sb
    .from("escrow_holds")
    .select("order_id, amount")
    .eq("status", "held");
  const liveByOrder = new Map<string, number>();
  for (const h of liveHolds || []) {
    if (h.order_id) liveByOrder.set(h.order_id, (liveByOrder.get(h.order_id) || 0) + (Number(h.amount) || 0));
  }

  const orderIds = [...liveByOrder.keys()];
  const liveOwnerSum = new Map<string, number>(); // customer_id -> sum
  if (orderIds.length > 0) {
    const { data: orders } = await sb
      .from("orders")
      .select("id, customer_id, status")
      .in("id", orderIds);
    for (const o of orders || []) {
      if (!o.customer_id) continue;
      const s = String(o.status || "");
      if (s === "delivered" || s === "cancelled" || s === "failed") continue;
      const amt = liveByOrder.get(o.id) || 0;
      if (amt > 0) liveOwnerSum.set(o.customer_id, (liveOwnerSum.get(o.customer_id) || 0) + amt);
    }
  }

  // Drifts: wallets whose stored escrow_balance != derived sum.
  const { data: wallets } = await sb.from("wallets").select("user_id, escrow_balance");
  for (const w of wallets || []) {
    const stored = Number((w as { escrow_balance?: number }).escrow_balance) || 0;
    const expected = liveOwnerSum.get((w as { user_id: string }).user_id) || 0;
    if (stored !== expected) {
      await sb
        .from("wallets")
        .update({ escrow_balance: expected, updated_at: new Date().toISOString() })
        .eq("user_id", (w as { user_id: string }).user_id);
    }
  }
}

/**
 * Returns escrow holds whose order no longer exists — the orphan set. Use it to
 * decide whether the customer's displayed balance over-reports and whether the
 * wallet ledger can be updated to clear the phantom hold.
 */
/**
  * Returns escrow holds whose order no longer exists — the orphan set. Use it to
  * decide whether the customer's displayed balance over-reports and whether the
  * wallet ledger can be updated to clear the phantom hold.
  */
export async function getOrphanedEscrowHolds(sb: SupabaseClient): Promise<string[]> {
  try {
    const { data: holds, error: holdsError } = await sb
      .from("escrow_holds")
      .select("id, order_id, amount")
      .eq("status", "held");
    if (holdsError || !holds || holds.length === 0) return [];

    const orderIds = [...new Set(holds.map((h) => h.order_id).filter(Boolean))];
    if (orderIds.length === 0) return [];

    const { data: orders, error: ordersError } = await sb
      .from("orders")
      .select("id, status")
      .in("id", orderIds);
    if (ordersError) return [];

    const statusById = new Map((orders || []).map((o) => [o.id, String((o as { status?: string }).status || "")]));
    // Orphans: orders that no longer exist OR are terminal (delivered/cancelled/failed).
    const orphaned = holds.filter((h) => {
      const s = statusById.get(h.order_id);
      return s === undefined || s === "delivered" || s === "cancelled" || s === "failed";
    });
    return orphaned.map((h) => h.order_id);
  } catch {
    return [];
  }
}

export async function holdEscrow(
  sb: SupabaseClient,
  userId: string,
  orderId: string,
  amount: number,
): Promise<{ success: boolean; message: string; holdId?: string | null }> {
  const { data, error } = await sb.rpc("hold_escrow", {
    p_user_id: userId,
    p_order_id: orderId,
    p_amount: Math.round(amount),
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ success: boolean; message: string }>)[0];
  if (!row) return { success: false, message: "No result" };
  if (!row.success) return { success: false, message: row.message };
  // The RPC only reports success/message, so resolve the hold id for the order
  // row. It is unique per order, so this is unambiguous.
  const { data: hold } = await sb
    .from("escrow_holds")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  return { success: true, message: row.message, holdId: hold?.id ?? null };
}

export type ReleaseResult = {
  success: boolean;
  message: string;
  customerFee: number;
  businessFee: number;
  riderFee: number;
  merchantPayout: number;
  riderPayout: number;
};

/**
 * Releases the hold and settles the 15% customer / 10% business / 5% rider
 * split. The percentages are passed explicitly (SQL defaults match) so the
 * caller and the database can never disagree, and the whole split is computed
 * inside one transactional function.
 */
export async function releaseEscrow(
  sb: SupabaseClient,
  orderId: string,
  percents: {
    customer?: number;
    business?: number;
    rider?: number;
  } = {},
): Promise<ReleaseResult> {
  const { data, error } = await sb.rpc("release_escrow", {
    p_order_id: orderId,
    p_customer_fee_percent: percents.customer ?? CUSTOMER_SERVICE_FEE_PERCENT,
    p_business_fee_percent: percents.business ?? BUSINESS_FEE_PERCENT,
    p_rider_fee_percent: percents.rider ?? RIDER_FEE_PERCENT,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{
    success: boolean;
    message: string;
    customer_fee: number;
    business_fee: number;
    rider_fee: number;
    merchant_payout: number;
    rider_payout: number;
  }>)[0];
  if (!row) {
    return {
      success: false, message: "No result",
      customerFee: 0, businessFee: 0, riderFee: 0, merchantPayout: 0, riderPayout: 0,
    };
  }
  return {
    success: row.success,
    message: row.message,
    customerFee: Number(row.customer_fee ?? 0),
    businessFee: Number(row.business_fee ?? 0),
    riderFee: Number(row.rider_fee ?? 0),
    merchantPayout: Number(row.merchant_payout ?? 0),
    riderPayout: Number(row.rider_payout ?? 0),
  };
}

export async function refundEscrow(
  sb: SupabaseClient,
  orderId: string,
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await sb.rpc("refund_escrow", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ success: boolean; message: string }>)[0];
  return row || { success: false, message: "No result" };
}

// ── Wallet ──────────────────────────────────────────────────────────

export async function getWallet(sb: SupabaseClient, userId: string): Promise<Wallet | null> {
  const { data } = await sb.from("wallets").select("*").eq("user_id", userId).maybeSingle();
  return data as Wallet | null;
}

export async function getLedger(sb: SupabaseClient, userId: string, limit = 50): Promise<LedgerEntry[]> {
  const { data } = await sb.from("ledger_entries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  return (data || []) as LedgerEntry[];
}

export async function getEscrowHold(sb: SupabaseClient, orderId: string): Promise<EscrowHold | null> {
  const { data } = await sb.from("escrow_holds").select("*").eq("order_id", orderId).maybeSingle();
  return data as EscrowHold | null;
}
