import { NextResponse } from "next/server";
import { resolveUgxRate } from "@/lib/live-rate";
import { usdtConfig } from "@/lib/wallet-store";
export const runtime = "nodejs";

/**
 * Morse partner wallet helpers.
 *
 *   GET /api/morse          → public config (handle, referral code, download
 *                             link, network, UGX↔USDT rate) so any page can
 *                             point people at Morse + GoDoor's referral code.
 *   POST /api/morse/tag     → see ./tag/route.ts (signed-in users set/confirm
 *                             their unique Morse username).
 */

export async function GET() {
  const { data: fees } = await (await import("@/lib/fees")).resolveFees(null);
  const ugxPerUsd = await resolveUgxRate(fees.ugx_per_usd ?? null);
  return NextResponse.json({
    ok: true,
    config: {
      handle: usdtConfig.handle,
      network: usdtConfig.network,
      referralCode: usdtConfig.referralCode,
      downloadUrl: usdtConfig.downloadUrl,
      rateUgx: Math.round(ugxPerUsd),
    },
  });
}