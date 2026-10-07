/**
 * DB-backed wallet + ledger for GoDoor.
 *
 * This is the single implementation of money on the platform. It is bound to
 * the canonical schema:
 *
 *   wallets         — authoritative UGX balance (available_balance / escrow_balance)
 *   ledger_entries  — immutable, append-only audit trail of every balance change
 *   deposits        — a customer's top-up request, pending until settled
 *
 * Every mutation goes through a SECURITY DEFINER RPC (credit_wallet_currency /
 * debit_wallet_currency / grant_signup_bonus), so a balance can never change
 * outside an audited, atomic write. Nothing here reads a denormalised running
 * balance: `wallets.available_balance` is the truth and the ledger is history.
 *
 * Previously this file ran against `wallet_ledger` and `topup_requests`, two
 * tables that never existed in the database. The customer flow wrote to
 * `deposits` while the admin credited the missing legacy tables, so an approved
 * deposit was never paid out and never appeared in history. Both paths now
 * converge on one ledger.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Network = "mtn_momo" | "airtel_money";

export type WalletCurrency = "UGX" | "USDT";

export type LedgerEntry = {
  id: string;
  type: string;
  amountUgx: number;
  balanceAfter: number;
  status: string;
  reference: string;
  currency: WalletCurrency;
  network?: string;
  phone?: string;
  note?: string;
  createdAt: string;
};

export type WalletState = {
  userId: string;
  availableUgx: number;
  availableUsdt: number;
  pendingUgx: number;
  pendingUsdt: number;
  currency: "UGX";
  ledger: LedgerEntry[];
};

export type TopupMethod = "morse" | "momo";

/** Admin-facing top-up request, shaped as the admin portal and webhook expect. */
export type TopupRequest = {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  amount_ugx: number;
  phone: string;
  network: string;
  reference: string;
  method: TopupMethod;
  currency: WalletCurrency;
  screenshot_url: string | null;
  status: string;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/**
 * `deposits` speaks the database's vocabulary (pending/confirmed/failed); the
 * admin portal and the customer-facing history speak credited/rejected. Keep
 * the translation in one place so a status can never mean two things.
 */
function toPublicStatus(s: string): string {
  const v = String(s || "pending");
  if (v === "confirmed" || v === "credited") return "credited";
  if (v === "failed" || v === "rejected") return "rejected";
  return "pending";
}

function fromPublicStatus(s: string): string {
  const v = String(s || "");
  if (v === "credited") return "confirmed";
  if (v === "rejected") return "failed";
  return v;
}

function meta(row: any): Record<string, any> {
  return (row && typeof row.metadata === "object" && row.metadata) || {};
}

/**
 * The authoritative balance.
 *
 * UGX lives on the wallet row. USDT has no wallet row of its own, so its
 * balance is the sum of its ledger entries — every USDT movement in the system
 * is written by credit_wallet_currency / debit_wallet_currency.
 */
async function latestBalance(sb: SupabaseClient, userId: string, currency: WalletCurrency): Promise<number> {
  if (currency === "USDT") {
    const { data, error } = await sb.rpc("usdt_balance", { p_user_id: userId });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  }
  const { data, error } = await sb.from("wallets").select("available_balance").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? Number((data as { available_balance: number }).available_balance) || 0 : 0;
}

function toLedger(r: any): LedgerEntry {
  const m = (r && typeof r.meta === "object" && r.meta) || {};
  return {
    id: r.id,
    type: r.type,
    amountUgx: Number(r.amount) || 0,
    balanceAfter: 0, // filled in by withRunningBalances — the ledger has no stored running total
    status: r.status || "posted",
    reference: r.ref_id || m.reference_code || "",
    currency: r.currency === "USDT" ? "USDT" : "UGX",
    network: m.network || m.provider || undefined,
    phone: m.phone || undefined,
    note: m.note || "",
    createdAt: r.created_at,
  };
}

/**
 * Reconstruct the running balance per entry for display.
 *
 * `ledger_entries` is append-only and stores no running total by design, so the
 * balance shown next to each row is derived from today's balance by walking the
 * entries backwards. Rows must arrive newest-first.
 */
function withRunningBalances(rows: any[], ugx: number, usdt: number): LedgerEntry[] {
  let runningUgx = ugx;
  let runningUsdt = usdt;
  return rows.map((r) => {
    const entry = toLedger(r);
    entry.balanceAfter = entry.currency === "USDT" ? runningUsdt : runningUgx;
    // balanceAfter(N-1) = balanceAfter(N) - amount(N)
    const amount = Number(r.amount) || 0;
    if (entry.currency === "USDT") runningUsdt -= amount;
    else runningUgx -= amount;
    return entry;
  });
}

function toTopupRequest(r: any): TopupRequest {
  const m = meta(r);
  const profile = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) || {};
  return {
    id: r.id,
    user_id: r.user_id,
    user_name: profile.full_name || profile.name || m.user_name || "",
    user_email: profile.email || m.user_email || "",
    amount_ugx: Number(r.amount) || 0,
    phone: String(m.phone || ""),
    network: String(m.network || ""),
    reference: r.reference_code || "",
    method: r.provider === "morse" ? "morse" : "momo",
    currency: r.currency === "USDT" ? "USDT" : "UGX",
    screenshot_url: m.screenshot_url ? String(m.screenshot_url) : null,
    status: toPublicStatus(r.status),
    admin_note: r.admin_note || null,
    reviewed_by: m.reviewed_by || null,
    reviewed_at: r.confirmed_at || null,
    created_at: r.created_at,
  };
}

export async function snapshotWallet(sb: SupabaseClient, userId: string): Promise<WalletState> {
  const [balanceUgx, balanceUsdt, { data: pendRows }, { data: rows }] = await Promise.all([
    latestBalance(sb, userId, "UGX"),
    latestBalance(sb, userId, "USDT"),
    sb
      .from("deposits")
      .select("id, amount, currency, reference_code, provider, metadata, created_at")
      .eq("user_id", userId)
      .eq("status", "pending"),
    sb.from("ledger_entries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
  ]);

  const pend = (pendRows || []) as any[];
  const sumBy = (cur: WalletCurrency) =>
    pend.reduce((s, r) => s + (r.currency === cur ? Number(r.amount) || 0 : 0), 0);
  const pendingUgx = sumBy("UGX");
  const pendingUsdt = sumBy("USDT");

  // Pending requests are not ledger entries yet, but the customer expects to
  // see them as "in flight" against the balance they have not been paid into.
  const pendingEntries: LedgerEntry[] = pend.map((p: any) => {
    const m = p.metadata || {};
    return {
      id: p.id,
      type: "topup_pending",
      amountUgx: Number(p.amount) || 0,
      balanceAfter: p.currency === "USDT" ? balanceUsdt : balanceUgx,
      status: "pending",
      reference: p.reference_code || "",
      currency: p.currency === "USDT" ? "USDT" : "UGX",
      network: p.provider === "morse" ? "Morse" : m.network || undefined,
      phone: m.phone || undefined,
      note: p.provider === "morse" ? "Waiting for Morse verification" : "Waiting for admin verification",
      createdAt: p.created_at,
    };
  });

  const ledger = [
    ...pendingEntries,
    ...withRunningBalances(rows || [], balanceUgx, balanceUsdt),
  ];

  return {
    userId,
    availableUgx: balanceUgx,
    availableUsdt: balanceUsdt,
    pendingUgx,
    pendingUsdt,
    currency: "UGX",
    ledger: ledger.slice(0, 50),
  };
}

export async function creditWallet(
  sb: SupabaseClient,
  userId: string,
  input: {
    amountUgx: number;
    reference: string;
    currency?: WalletCurrency;
    phone?: string;
    network?: string;
    note?: string;
    relatedId?: string;
  },
): Promise<WalletState> {
  if (!input.amountUgx || input.amountUgx <= 0) throw new Error("Invalid credit amount");
  const currency: WalletCurrency = input.currency === "USDT" ? "USDT" : "UGX";
  const { error } = await sb.rpc("credit_wallet_currency", {
    p_user_id: userId,
    p_amount: Math.round(input.amountUgx),
    p_currency: currency,
    p_reference: input.reference,
    p_note: input.note || (currency === "USDT" ? "USDT credited" : "Wallet credited"),
    p_meta: { phone: input.phone || "", network: input.network || "", related_id: input.relatedId || "" },
  });
  if (error) throw new Error(error.message);
  return snapshotWallet(sb, userId);
}

export async function debitWallet(
  sb: SupabaseClient,
  userId: string,
  input: { amountUgx: number; reference: string; note: string; currency?: WalletCurrency },
): Promise<{ wallet: WalletState; entry: LedgerEntry }> {
  if (!input.amountUgx || input.amountUgx <= 0) throw new Error("Invalid amount");
  const currency: WalletCurrency = input.currency === "USDT" ? "USDT" : "UGX";
  const { data, error } = await sb.rpc("debit_wallet_currency", {
    p_user_id: userId,
    p_amount: Math.round(input.amountUgx),
    p_currency: currency,
    p_reference: input.reference,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const result = (Array.isArray(data) ? data[0] : data) as { success?: boolean; message?: string } | null;
  if (result && result.success === false) throw new Error(result.message || "Insufficient wallet balance");

  const wallet = await snapshotWallet(sb, userId);
  const entry =
    wallet.ledger.find((e) => e.reference === input.reference && e.amountUgx < 0) ??
    ({ id: "", type: "payment", amountUgx: -input.amountUgx, balanceAfter: wallet.availableUgx,
       status: "posted", reference: input.reference, currency, note: input.note, createdAt: new Date().toISOString() } as LedgerEntry);
  return { wallet, entry };
}

/** Free service fee every new customer gets on signup (covers first orders). */
export const SIGNUP_BONUS_UGX = 2000;

/** Idempotent: the RPC refuses to grant a second SIGNUP-BONUS entry. */
export async function grantSignupBonus(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { error } = await sb.rpc("grant_signup_bonus", { p_user_id: userId, p_amount: SIGNUP_BONUS_UGX });
    return !error;
  } catch {
    return false;
  }
}

/** Roll up the whole gas-fee balance into spendable UGX (free bonus + Morse USDT at rate). */
export async function gasFeeBalanceUgx(sb: SupabaseClient, userId: string, rateUgx: number): Promise<{ gasUgx: number; ugx: number; usdt: number; rateUgx: number }> {
  const snap = await snapshotWallet(sb, userId);
  return {
    gasUgx: snap.availableUgx + snap.availableUsdt * rateUgx,
    ugx: snap.availableUgx,
    usdt: snap.availableUsdt,
    rateUgx,
  };
}

/**
 * Spend from the GoDoor gas-fee balance for an order/service. Spends free UGX
 * bonus first, then converts Morse USDT at the configured rate for the rest.
 * Every row is an immutable ledger entry — this never touches simulated money.
 */
export async function debitGasFee(
  sb: SupabaseClient,
  userId: string,
  input: { amountUgx: number; reference: string; note: string; rateUgx: number },
): Promise<WalletState> {
  if (!input.amountUgx || input.amountUgx <= 0) throw new Error("Invalid amount");
  let remaining = input.amountUgx;

  const ugxBalance = await latestBalance(sb, userId, "UGX");
  if (ugxBalance > 0) {
    const ugxPart = Math.min(ugxBalance, remaining);
    await debitWallet(sb, userId, {
      amountUgx: ugxPart,
      reference: input.reference,
      note: input.note,
      currency: "UGX",
    });
    remaining -= ugxPart;
  }

  if (remaining > 0) {
    const requiredUsdt = Math.ceil(remaining / input.rateUgx);
    const usdtBalance = await latestBalance(sb, userId, "USDT");
    if (usdtBalance < requiredUsdt) {
      throw new Error("INSUFFICIENT_GAS_FEE");
    }
    await debitWallet(sb, userId, {
      amountUgx: requiredUsdt,
      reference: `${input.reference}:USDT`,
      note: input.note,
      currency: "USDT",
    });
  }

  return snapshotWallet(sb, userId);
}

export async function createTopupRequest(
  sb: SupabaseClient,
  input: {
    userId: string;
    userName: string;
    userEmail: string;
    amountUgx: number;
    phone: string;
    network: string;
    reference: string;
    method?: TopupMethod;
    currency?: WalletCurrency;
    screenshotUrl?: string;
  },
): Promise<TopupRequest> {
  // Power-smash-safe: one pending request per reference.
  const { data: existing } = await sb
    .from("deposits")
    .select("*")
    .eq("reference_code", input.reference)
    .maybeSingle();
  if (existing) return toTopupRequest(existing);

  const method: TopupMethod = input.method === "morse" ? "morse" : "momo";
  const currency: WalletCurrency = method === "morse" ? "USDT" : input.currency === "USDT" ? "USDT" : "UGX";
  const { data, error } = await sb
    .from("deposits")
    .insert({
      user_id: input.userId,
      provider: method === "morse" ? "morse" : "momo",
      provider_ref: input.reference,
      amount: Math.round(input.amountUgx),
      currency,
      status: "pending",
      reference_code: input.reference,
      metadata: {
        phone: input.phone,
        network: method === "morse" ? "usdt" : input.network,
        user_name: input.userName,
        user_email: input.userEmail,
        screenshot_url: input.screenshotUrl || null,
      },
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return toTopupRequest(data);
}

export async function findTopupRequest(sb: SupabaseClient, userId: string, reference: string): Promise<TopupRequest | null> {
  const { data } = await sb
    .from("deposits")
    .select("*, profiles(full_name, name, email)")
    .eq("reference_code", reference)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? toTopupRequest(data) : null;
}

export async function listTopupRequests(sb: SupabaseClient, status?: string): Promise<TopupRequest[]> {
  let q = sb
    .from("deposits")
    .select("*, profiles(full_name, name, email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", fromPublicStatus(status));
  const { data, error } = await q;
  if (error) return [];
  return (data || []).map(toTopupRequest);
}

export async function setTopupStatus(
  sb: SupabaseClient,
  id: string,
  status: string,
  adminName: string,
  note: string | null,
): Promise<boolean> {
  const upd: Record<string, unknown> = {
    status: fromPublicStatus(status),
    admin_note: note || "",
    confirmed_at: new Date().toISOString(),
  };
  // Only a still-pending request can be settled (no double credits).
  const { error } = await sb.from("deposits").update(upd).eq("id", id).eq("status", "pending");
  return !error;
}

export async function attachTopupScreenshot(sb: SupabaseClient, id: string, screenshotUrl: string): Promise<boolean> {
  // `metadata` is merged in SQL so attaching a proof image never discards the
  // phone/network the customer already submitted with the request.
  const { error } = await sb.rpc("attach_deposit_screenshot", {
    p_deposit_id: id,
    p_screenshot_url: screenshotUrl,
  });
  return !error;
}