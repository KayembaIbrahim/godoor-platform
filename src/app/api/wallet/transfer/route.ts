import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";
import { getWallet } from "@/lib/escrow";
import { verifySpendGrant, walletSecurityEnrolled } from "@/lib/wallet-security";
import {
  claimIdempotencyKey,
  claimTransferLocks,
  findIdempotentTransfer,
  listInboxTransfers,
  listUserTransfers,
  moveTransferFunds,
  newTransferId,
  normalizeEmail,
  readTransferConfig,
  recipientLabel,
  releaseIdempotencyKey,
  releaseTransferLocks,
  resolveRecipientByEmail,
  resolveTransferConfig,
  splitTransfer,
  sumSentToday,
  transferReference,
  validateTransfer,
  type TransferRecord,
} from "@/lib/transfer";

/**
 * Send wallet balance to another GoDoor user by email.
 *
 * Money lands in the recipient's available balance immediately — there is no
 * pending state to approve, because both parties already hold verified GoDoor
 * accounts. Everything a dispute needs is written at send time: both ledger
 * legs sharing one ref_id, plus the kv record the admin console reads.
 */

const RequestSchema = z.object({
  amount: z.coerce.number().int().positive(),
  toEmail: z.string().min(3).max(254),
  note: z.string().max(140).optional().default(""),
  /** Stable per attempt so a double-tap cannot send twice. */
  clientKey: z.string().min(8).max(80),
});

/** GET — what the sheet needs: config, balance, both sides of the history. */
export async function GET(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Wallet unavailable" }, { status: 503 });

  const [cfg, wallet, sent, received, enrolled] = await Promise.all([
    readTransferConfig(sb),
    getWallet(sb, actor.id),
    listUserTransfers(sb, actor.id),
    listInboxTransfers(sb, actor.id),
    walletSecurityEnrolled(sb, actor.id),
  ]);

  const available = Number(wallet?.available_balance ?? 0);
  const cfgPublic = resolveTransferConfig(cfg);

  return NextResponse.json({
    data: {
      config: cfgPublic,
      available,
      enrolled,
      requiresPin: cfgPublic.require_pin && enrolled,
      sent,
      received,
      sentToday: sumSentToday(sent),
    },
  });
}

/** POST — send money to another GoDoor account. */
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
    return NextResponse.json({ error: "Enter a valid amount and email address." }, { status: 400 });
  }

  const cfg = await readTransferConfig(sb);
  if (!cfg.enabled) {
    return NextResponse.json({ error: "Sending money is temporarily unavailable." }, { status: 503 });
  }

  /* ── Authorisation before any money is touched ───────────────────────────
     Same HMAC spend grant the order and withdrawal routes demand. A React flag
     proves nothing, so the client is never consulted. */
  if (cfg.require_pin && (await walletSecurityEnrolled(sb, actor.id))) {
    const grant = req.headers.get("x-wallet-grant");
    if (!(await verifySpendGrant(grant, actor.id))) {
      return NextResponse.json(
        { error: "Unlock your wallet to send money", code: "WALLET_LOCK_REQUIRED" },
        { status: 428 },
      );
    }
  }

  const { amount, toEmail: rawEmail, note, clientKey } = parsed.data;
  const toEmail = normalizeEmail(rawEmail);

  /* ── Idempotency ──────────────────────────────────────────────────────────
     The spend grant above is stateless and reusable for 90s, so a double-tap
     inside that window would otherwise send twice. Claiming the client's key
     first means the retry returns the transfer that already happened. */
  const transferId = newTransferId();
  const claimed = await claimIdempotencyKey(sb, actor.id, clientKey, transferId);
  if (!claimed) {
    const prior = await findIdempotentTransfer(sb, actor.id, clientKey);
    if (prior) {
      /* Already sent. Report success so the UI settles instead of showing an
         error for something the user has actually got. */
      const wallet = await getWallet(sb, actor.id);
      return NextResponse.json({
        data: { transfer: prior, balance: Number(wallet?.available_balance ?? 0), duplicate: true },
      });
    }
    return NextResponse.json({ error: "That request is already being processed." }, { status: 409 });
  }

  /* Give the key back if this attempt never moves money, so "try again" works
     after a typo. From the money move onward it stays claimed. */
  let committed = false;
  const undoClaim = async () => {
    if (!committed) await releaseIdempotencyKey(sb, actor.id, clientKey);
  };

  /* ── Recipient ──────────────────────────────────────────────────────────── */
  const found = await resolveRecipientByEmail(sb, toEmail);
  if (!found.ok) {
    await undoClaim();
    return NextResponse.json({ error: found.error }, { status: 404 });
  }
  const recipient = found.user;
  const recipientName = found.name;

  if (recipient.id === actor.id) {
    await undoClaim();
    return NextResponse.json(
      { error: "You cannot send money to your own account." },
      { status: 400 },
    );
  }

  /* ── Serialise both parties ───────────────────────────────────────────────
     Both users are locked, in sorted order by claimTransferLocks, because the
     credit touches the recipient's balance as surely as the debit touches ours. */
  const parties = [actor.id, recipient.id];
  const locked = await claimTransferLocks(sb, parties);
  if (!locked) {
    await undoClaim();
    return NextResponse.json(
      { error: "That account is busy with another payment. Try again in a moment." },
      { status: 409 },
    );
  }

  try {
    /* Balance is read INSIDE the lock, never from a pre-lock value. */
    const wallet = await getWallet(sb, actor.id);
    const available = Number(wallet?.available_balance ?? 0);
    const sent = await listUserTransfers(sb, actor.id, 100);

    const check = validateTransfer({
      amountUgx: amount,
      availableUgx: available,
      alreadyTodayUgx: sumSentToday(sent),
      toEmail,
      selfUserId: actor.id,
      toUserId: recipient.id,
      cfg,
    });
    if (!check.ok) {
      await undoClaim();
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const split = splitTransfer(amount, cfg);
    const record: TransferRecord = {
      id: transferId,
      reference: transferReference(),
      fromUserId: actor.id,
      fromEmail: normalizeEmail(actor.email),
      fromName: "",
      toUserId: recipient.id,
      toEmail: recipient.email,
      toName: recipientName,
      amount: split.gross,
      fee: split.fee,
      feePercent: split.feePercent,
      net: split.net,
      currency: "UGX",
      note: String(note || "").slice(0, 140),
      status: "completed",
      reversalReason: "",
      createdAt: new Date().toISOString(),
    };

    const moved = await moveTransferFunds(sb, record);
    if (!moved.ok) {
      await undoClaim();
      return NextResponse.json(
        { error: moved.error, needsSupport: !moved.compensated },
        { status: 402 },
      );
    }
    committed = true;

    /* ── Records ─────────────────────────────────────────────────────────────
       The record is the admin console's source of truth and both users'
       history. Written after the money moves so a stored record always implies
       a completed transfer. */
    const now = new Date().toISOString();
    const mine = [record, ...sent].slice(0, 50);
    const inbox = await listInboxTransfers(sb, recipient.id, 100);

    await Promise.all([
      sb
        .from("app_settings")
        .upsert(
          { key: `transfer:rec:${record.id}`, value: JSON.stringify(record), updated_at: now },
          { onConflict: "key" },
        ),
      sb
        .from("app_settings")
        .upsert(
          { key: `transfer:user:${actor.id}`, value: JSON.stringify(mine), updated_at: now },
          { onConflict: "key" },
        ),
      sb
        .from("app_settings")
        .upsert(
          {
            key: `transfer:inbox:${recipient.id}`,
            value: JSON.stringify([record, ...inbox].slice(0, 50)),
            updated_at: now,
          },
          { onConflict: "key" },
        ),
    ]);

    return NextResponse.json({
      data: {
        transfer: record,
        balance: moved.senderBalance,
        recipient: recipientLabel(recipientName, recipient.email),
        recipientBalance: moved.recipientBalance,
      },
    });
  } finally {
    await releaseTransferLocks(sb, parties);
  }
}
export const runtime = "edge";
