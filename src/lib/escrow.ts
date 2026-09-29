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
