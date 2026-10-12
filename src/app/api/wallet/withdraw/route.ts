import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";
import { getWallet } from "@/lib/escrow";
import { verifySpendGrant, walletSecurityEnrolled } from "@/lib/wallet-security";
import {
  claimWithdrawalLock,
  debitWallet,
  listUserWithdrawals,
  newWithdrawalId,
  readWithdrawalConfig,
  releaseWithdrawalLock,
  resolveUserMorseTag,
  resolveWithdrawalRole,
  splitWithdrawal,
  sumRequestedToday,
  validateWithdrawal,
  withdrawalReference,
  type WithdrawalRecord,
} from "@/lib/withdrawal";

/**
 * The destination is deliberately absent. Money always goes to the requester's
 * own GoDoor Morse wallet, so there is nothing for the client to supply — and
 * nothing it could tamper with to redirect the payout.
 */
const RequestSchema = z.object({
  amount: z.coerce.number().int().positive(),
  note: z.string().max(140).optional().default(""),
});

/** GET — config the UI needs, plus this user's balance and history. */
export async function GET(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const cfg = await readWithdrawalConfig(sb);
  const [wallet, history, role, enrolled, morseTag] = await Promise.all([
    getWallet(sb, actor.id),
    listUserWithdrawals(sb, actor.id),
    resolveWithdrawalRole(sb, actor.id),
    walletSecurityEnrolled(sb, actor.id),
    resolveUserMorseTag(sb, actor.id),
  ]);

  const available = Number(wallet?.available_balance ?? 0);
  const escrow = Number(wallet?.escrow_balance ?? 0);

  return NextResponse.json({
    data: {
      config: cfg,
      role,
      available,
      escrow,
      /** Money currently moving through orders is not withdrawable. */
      withdrawable: available,
      enrolled,
      /** The only payout rail. Empty means the user has no Morse wallet yet. */
      morseTag,
      /** True when this request must be unlocked before it can be made. */
      requiresPin: cfg.enabled && cfg.require_pin && enrolled,
      history,
    },
  });
}

/** POST — request a payout to the requester's own GoDoor Morse wallet. */
export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid amount in UGX." }, { status: 400 });
  }

  const cfg = await readWithdrawalConfig(sb);
  if (!cfg.enabled) {
    return NextResponse.json({ error: "Withdrawals are temporarily unavailable." }, { status: 503 });
  }

  /* ── Authorisation before any money is touched ───────────────────────────
     Same grant the order route demands: an HMAC-signed, user-scoped token
     minted within the last 90 seconds by the wallet lock. A React flag is not
     evidence of anything, so the client is never consulted. */
  if (cfg.require_pin && (await walletSecurityEnrolled(sb, actor.id))) {
    const grant = req.headers.get("x-wallet-grant");
    if (!(await verifySpendGrant(grant, actor.id))) {
      return NextResponse.json(
        { error: "Unlock your wallet to confirm this withdrawal", code: "WALLET_LOCK_REQUIRED" },
        { status: 428 },
      );
    }
  }

  const role = await resolveWithdrawalRole(sb, actor.id);
  const history = await listUserWithdrawals(sb, actor.id, 100);

  /* ── Serialise per user ──────────────────────────────────────────────────
     The claim is an INSERT against a primary key, so a second concurrent
     request from the same account gets a 409 rather than racing the
     read-modify-write in debitWallet. */
  const locked = await claimWithdrawalLock(sb, actor.id);
  if (!locked) {
    return NextResponse.json(
      { error: "Another withdrawal is still being processed. Try again in a moment." },
      { status: 409 },
    );
  }

  try {
    // Balance is read INSIDE the lock, never from a pre-lock value. So is the
    // destination: resolving it here means the tag recorded on the payout is
    // the one that was live at the moment the balance was debited.
    const [wallet, morseTag] = await Promise.all([
      getWallet(sb, actor.id),
      resolveUserMorseTag(sb, actor.id),
    ]);
    const available = Number(wallet?.available_balance ?? 0);

    const check = validateWithdrawal({
      amountUgx: parsed.data.amount,
      availableUgx: available,
      alreadyTodayUgx: sumRequestedToday(history),
      morseTag,
      cfg,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const split = splitWithdrawal(parsed.data.amount, role, cfg);
    const record: WithdrawalRecord = {
      id: newWithdrawalId(),
      userId: actor.id,
      email: actor.email,
      role,
      gross: split.gross,
      fee: split.fee,
      feePercent: split.feePercent,
      net: split.net,
      currency: "UGX",
      destination: "morse",
      morseTag,
      status: "pending",
      reference: withdrawalReference(),
      note: String(parsed.data.note || "").slice(0, 140),
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      adminNote: "",
    };

    try {
      await debitWallet(sb, actor.id, split.gross, record);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Could not withdraw right now" },
        { status: 402 },
      );
    }

    await sb
      .from("app_settings")
      .upsert(
        {
          key: `withdrawal:user:${actor.id}`,
          value: JSON.stringify([record, ...history].slice(0, 50)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    await sb
      .from("app_settings")
      .upsert(
        {
          key: `withdrawal:rec:${record.id}`,
          value: JSON.stringify(record),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );

    return NextResponse.json({ data: { withdrawal: record, balance: available - split.gross } });
  } finally {
    await releaseWithdrawalLock(sb, actor.id);
  }
}

export const runtime = "nodejs";
