/**
 * DB-backed wallet + ledger for GoDoor.
 *
 * Balances are never invented on the client: every credit/debit is an
 * immutable row in `wallet_ledger`, and the available balance is always the
 * newest row's balance_after (per currency). Credits only happen server-side,
 * after the admin verifies that real money arrived (reference + admin credit
 * flow) or that a P2P USDT payment screenshot is real. Pending top-ups live in
 * `topup_requests` until an admin credits or rejects them.
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

function toLedger(r: any): LedgerEntry {
  const currency: WalletCurrency = r.currency === "USDT" ? "USDT" : "UGX";
  return {
    id: r.id,
    type: r.type,
    amountUgx: Number(r.amount_ugx) || 0,
    balanceAfter: Number(r.balance_after) || 0,
    status: r.status,
    reference: r.reference || "",
    currency,
    network: r.network || undefined,
    phone: r.phone || undefined,
    note: r.note || "",
    createdAt: r.created_at,
  };
}

function toTopupRequest(r: any): TopupRequest {
  return {
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name || "",
    user_email: r.user_email || "",
    amount_ugx: Number(r.amount_ugx) || 0,
    phone: r.phone || "",
    network: r.network || "",
    reference: r.reference || "",
    method: r.method === "morse" ? "morse" : "momo",
    currency: r.currency === "USDT" ? "USDT" : "UGX",
    screenshot_url: r.screenshot_url || null,
    status: r.status || "pending",
    admin_note: r.admin_note || null,
    reviewed_by: r.reviewed_by || null,
    reviewed_at: r.reviewed_at || null,
    created_at: r.created_at,
  };
}

async function latestBalance(sb: SupabaseClient, userId: string, currency: WalletCurrency): Promise<number> {
  const { data } = await sb
    .from("wallet_ledger")
    .select("balance_after")
    .eq("user_id", userId)
    .eq("currency", currency)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number((data as { balance_after: number }).balance_after) || 0 : 0;
}

export async function snapshotWallet(sb: SupabaseClient, userId: string): Promise<WalletState> {
  const [balanceUgx, balanceUsdt, { data: pendRows }, { data: rows }] = await Promise.all([
    latestBalance(sb, userId, "UGX"),
    latestBalance(sb, userId, "USDT"),
    sb.from("topup_requests").select("id, amount_ugx, reference, network, phone, method, currency, created_at").eq("user_id", userId).eq("status", "pending"),
    sb.from("wallet_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
  ]);

  const pendingUgx = (pendRows || []).reduce(
    (s, r) => s + ((r as { currency: string; amount_ugx: number }).currency === "USDT" ? 0 : Number((r as { amount_ugx: number }).amount_ugx) || 0),
    0,
  );
  const pendingUsdt = (pendRows || []).reduce(
    (s, r) => s + ((r as { currency: string; amount_ugx: number }).currency === "USDT" ? Number((r as { amount_ugx: number }).amount_ugx) || 0 : 0),
    0,
  );
  const pendingBalance = (r: any) => (r.currency === "USDT" ? balanceUsdt : balanceUgx);
  const ledger: LedgerEntry[] = (pendRows || []).map((p: any) => ({
    id: p.id,
    type: "topup_pending",
    amountUgx: Number(p.amount_ugx) || 0,
    balanceAfter: pendingBalance(p),
    status: "pending",
    reference: p.reference,
    currency: p.currency === "USDT" ? "USDT" : "UGX",
    network: p.method === "morse" ? "Morse" : p.network || undefined,
    phone: p.phone || undefined,
    note: p.method === "morse" ? "Waiting for Morse verification" : "Waiting for admin verification",
    createdAt: p.created_at,
  }));
  ledger.push(...(rows || []).map(toLedger));

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
  const balance = (await latestBalance(sb, userId, currency)) + input.amountUgx;
  const { error } = await sb.from("wallet_ledger").insert({
    user_id: userId,
    type: "topup",
    amount_ugx: input.amountUgx,
    balance_after: balance,
    status: "posted",
    currency,
    reference: input.reference,
    network: input.network || "",
    phone: input.phone || "",
    note: input.note || (currency === "USDT" ? "USDT credited" : "Wallet credited"),
    related_id: input.relatedId || "",
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
  const balance = await latestBalance(sb, userId, currency);
  if (balance < input.amountUgx) throw new Error("Insufficient wallet balance");
  const after = balance - input.amountUgx;
  const { data, error } = await sb.from("wallet_ledger").insert({
    user_id: userId,
    type: "payment",
    amount_ugx: -input.amountUgx,
    balance_after: after,
    status: "posted",
    currency,
    reference: input.reference,
    note: input.note,
  }).select().single();
  if (error) throw new Error(error.message);
  return { wallet: await snapshotWallet(sb, userId), entry: toLedger(data) };
}

/** Free service fee every new customer gets on signup (covers first orders). */
export const SIGNUP_BONUS_UGX = 2000;

export async function grantSignupBonus(sb: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data: existing } = await sb
      .from("wallet_ledger")
      .select("id")
      .eq("user_id", userId)
      .eq("reference", "SIGNUP-BONUS")
      .maybeSingle();
    if (existing) return false;
    await creditWallet(sb, userId, {
      amountUgx: SIGNUP_BONUS_UGX,
      reference: "SIGNUP-BONUS",
      currency: "UGX",
      note: `${SIGNUP_BONUS_UGX.toLocaleString()} UGX free service fee — welcome gas fee`,
    });
    return true;
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
  const { data: existing } = await sb.from("topup_requests").select("*").eq("reference", input.reference).maybeSingle();
  if (existing) return toTopupRequest(existing);

  const method: TopupMethod = input.method === "morse" ? "morse" : "momo";
  const currency: WalletCurrency = method === "morse" ? "USDT" : "UGX";
  const { data, error } = await sb.from("topup_requests").insert({
    user_id: input.userId,
    user_name: input.userName,
    user_email: input.userEmail,
    amount_ugx: input.amountUgx,
    phone: input.phone,
    network: method === "morse" ? "usdt" : input.network,
    reference: input.reference,
    method,
    currency,
    screenshot_url: input.screenshotUrl || null,
    status: "pending",
  }).select().single();
  if (error) throw new Error(error.message);
  return toTopupRequest(data);
}

export async function findTopupRequest(sb: SupabaseClient, userId: string, reference: string): Promise<TopupRequest | null> {
  const { data } = await sb.from("topup_requests").select("*").eq("reference", reference).eq("user_id", userId).maybeSingle();
  return data ? toTopupRequest(data) : null;
}

export async function listTopupRequests(sb: SupabaseClient, status?: string): Promise<TopupRequest[]> {
  let q = sb.from("topup_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
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
    status,
    admin_note: note || "",
    reviewed_by: adminName,
    reviewed_at: new Date().toISOString(),
  };
  // Only a still-pending request can be settled (no double credits).
  const { error } = await sb.from("topup_requests").update(upd).eq("id", id).eq("status", "pending");
  return !error;
}

export async function attachTopupScreenshot(sb: SupabaseClient, id: string, screenshotUrl: string): Promise<boolean> {
  const { error } = await sb.from("topup_requests").update({ screenshot_url: screenshotUrl }).eq("id", id);
  return !error;
}