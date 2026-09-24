import { NextResponse } from "next/server";
import { z } from "zod";
import { refreshRateUgx, requestCollection, usdtConfig } from "@/lib/momo";
import { attachTopupScreenshot, createTopupRequest, findTopupRequest, snapshotWallet } from "@/lib/wallet-store";
import { authorize } from "@/lib/api-auth";
import { getServiceClient } from "@/lib/supabase-server";

const StartSchema = z.object({
  amountUsdt: z.coerce.number().positive().max(100_000),
  phone: z.string().min(9).max(20).optional(),
  screenshotUrl: z.string().url().optional(),
});

const MomoStartSchema = z.object({
  method: z.literal("momo"),
  amountUgx: z.coerce.number().int().positive().max(10_000_000),
  phone: z.string().min(9).max(20),
  network: z.enum(["mtn_momo", "airtel_money"]),
});

const ReferenceSchema = z.object({
  reference: z.string().min(4).max(40),
  screenshotUrl: z.string().url().optional(),
});

/**
 * Wallet top-up via the Morse partner wallet.
 *
 * The customer tops up their own Morse wallet from mobile money (inside the
 * Morse app), then sends USDT to GoDoor's Morse username (@Godoor) with the
 * reference as the note. They can attach a send-confirmation screenshot.
 * Nothing is credited on the client's word — an admin verifies the transfer in
 * the Morse app and credits the wallet from /api/admin/wallet-credits.
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

  await refreshRateUgx();
  const cfg = usdtConfig();

  // Direct MTN/Airtel collection (live provider). Customer approves the STK
  // prompt on their phone; credit happens ONLY via /api/momo/webhook.
  if ((body as { method?: string }).method === "momo") {
    const momo = MomoStartSchema.safeParse(body);
    if (!momo.success) {
      return NextResponse.json({ error: { message: "Enter amount, phone and network." } }, { status: 400 });
    }
    if (momo.data.amountUgx < 1000) {
      return NextResponse.json({ error: { message: "Minimum top-up is UGX 1,000." } }, { status: 400 });
    }
    const digits = momo.data.phone.replace(/\D/g, "");
    const phone256 = digits.startsWith("256") ? digits : `256${digits.replace(/^0+/, "")}`;
    const reference = `GD${Date.now().toString(36).toUpperCase()}${phone256.slice(-3)}`;
    let collection;
    try {
      collection = await requestCollection({
        amountUgx: momo.data.amountUgx,
        phone256,
        network: momo.data.network,
        reference,
        description: `GoDoor wallet top-up ${reference}`,
      });
    } catch (e) {
      return NextResponse.json(
        { error: { message: e instanceof Error ? e.message : "Provider unavailable" } },
        { status: 502 },
      );
    }
    const reqRow = await createTopupRequest(sb, {
      userId: actor.id,
      userName: actor.email || "Customer",
      userEmail: actor.email || "",
      amountUgx: momo.data.amountUgx,
      phone: phone256,
      network: momo.data.network,
      reference,
      method: "momo",
      currency: "UGX",
    });
    return NextResponse.json({
      data: {
        topupId: reqRow.id,
        reference: reqRow.reference,
        amountUgx: reqRow.amount_ugx,
        phone: phone256,
        method: "momo",
        currency: "UGX",
        provider: collection.provider,
        providerRef: collection.providerRef,
        status: "awaiting_provider_confirmation",
        message: collection.customerHint,
      },
      meta: { wallet: await snapshotWallet(sb, actor.id) },
    });
  }

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
        rateUgx: cfg.rateUgx,
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
    `Send ${parsed.data.amountUsdt} USD (Morse shows it as the UGX equivalent) to GoDoor on Morse (@${cfg.handle.replace("@", "")}), and put ${reference} in the note.`,
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
      rateUgx: cfg.rateUgx,
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