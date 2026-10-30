import { NextResponse } from "next/server";
import { z } from "zod";
import { usdtConfig } from "@/lib/wallet-store";
import { attachTopupScreenshot, createTopupRequest, findTopupRequest, snapshotWallet } from "@/lib/wallet-store";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveUgxRate } from "@/lib/live-rate";
export const runtime = "nodejs";

const StartSchema = z.object({
  amountUsdt: z.coerce.number().positive().max(100_000),
  phone: z.string().min(9).max(20).optional(),
  screenshotUrl: z.string().url().optional(),
});

const ReferenceSchema = z.object({
  reference: z.string().min(4).max(40),
  screenshotUrl: z.string().url().optional(),
});

/**
 * Wallet top-up via the GoDoor/Morse wallet system.
 *
 * The customer sends USDT to GoDoor's Morse username (@Godoor) with the
 * reference as the note. They can attach a send-confirmation screenshot.
 * Nothing is credited on the client's word — an admin verifies the transfer
 * in the Morse app and credits the wallet from /api/admin/wallet-credits.
 */
export async function POST(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: { message: "Wallet unavailable" } }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: { message: "Invalid JSON" } }, { status: 400 });
  }

  const cfg = usdtConfig;
  const liveRateUgx = await resolveUgxRate(null);

  // "I've sent the money" — record nothing new, just return their pending request.
  if ("reference" in body) {
    const parsed = ReferenceSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: { message: "Invalid reference" } }, { status: 400 });
    const reqRow = await findTopupRequest(sb, actor.id, parsed.data.reference);
    if (!reqRow) return NextResponse.json({ error: { message: "Reference not found" } }, { status: 404 });
    if (parsed.data.screenshotUrl) {
      await attachTopupScreenshot(sb, reqRow.id, parsed.data.screenshotUrl);
    }
    return NextResponse.json({
      data: {
        topupId: reqRow.id,
        reference: reqRow.reference,
        amountUsdt: reqRow.amount_ugx,
        phone: reqRow.phone,
        handle: cfg.handle,
        network: cfg.network,
        referralCode: cfg.referralCode,
        downloadUrl: cfg.downloadUrl,
        rateUgx: liveRateUgx,
        method: "morse",
        currency: "USDT",
        networkLabel: "Morse Partner Wallet",
        status: "pending_verification",
        message: "Received — the GoDoor team will verify the transfer in Morse and credit your wallet shortly.",
      },
      meta: { wallet: await snapshotWallet(sb, actor.id) },
    });
  }

  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Enter a valid USD amount." } }, { status: 400 });
  }
  if (parsed.data.amountUsdt < 1) {
    return NextResponse.json({ error: { message: "Minimum is 1 USD." } }, { status: 400 });
  }

  const reference = `GD${Date.now().toString(36).toUpperCase()}${(parsed.data.phone || "000").replace(/\D/g, "").slice(-3)}`;
  const reqRow = await createTopupRequest(sb, {
    userId: actor.id,
    userName: actor.email || "Customer",
    userEmail: actor.email || "",
    amountUgx: parsed.data.amountUsdt,
    phone: parsed.data.phone || "",
    network: "usdt",
    reference,
    method: "morse",
    currency: "USDT",
    screenshotUrl: parsed.data.screenshotUrl,
  });

  const instructions = [
    `Open Morse and top up your Morse wallet from mobile money.`,
    `Send ${parsed.data.amountUsdt} USD (at ${liveRateUgx} UGX per USD) to GoDoor on Morse (@${cfg.handle.replace("@", "")}), and put ${reference} in the note.`,
    `Then tap "I've sent the money"${cfg.address ? ` and upload the send screenshot` : ""}. Our team verifies the transfer and credits your wallet.`,
  ].join(" ");

  return NextResponse.json({
    data: {
      topupId: reqRow.id,
      reference: reqRow.reference,
      amountUsdt: reqRow.amount_ugx,
      phone: reqRow.phone,
      handle: cfg.handle,
      network: cfg.network,
      referralCode: cfg.referralCode,
      downloadUrl: cfg.downloadUrl,
      rateUgx: liveRateUgx,
      method: "morse",
      currency: "USDT",
      networkLabel: "Morse Partner Wallet",
      status: "awaiting_payment",
      instructions,
    },
    meta: {
      note: "Your GoDoor wallet is funded from the Morse partner wallet. The admin verifies the transfer and credits you — nothing is auto-credited without verification.",
    },
  });
}

export async function GET(req: Request) {
  const actor = await authorize(req);
  if (!actor || actor.kind !== "user") {
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: { message: "Wallet unavailable" } }, { status: 503 });
  const wallet = await snapshotWallet(sb, actor.id);
  return NextResponse.json({ data: wallet, meta: { currency: "UGX", market: "UG" } });
}