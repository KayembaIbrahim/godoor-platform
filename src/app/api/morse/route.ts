import { NextResponse } from "next/server";
import { refreshRateUgx, usdtConfig } from "@/lib/momo";

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
  await refreshRateUgx();
  const cfg = usdtConfig();
  return NextResponse.json({
    ok: true,
    config: {
      handle: cfg.handle,
      network: cfg.network,
      referralCode: cfg.referralCode,
      downloadUrl: cfg.downloadUrl,
      rateUgx: cfg.rateUgx,
    },
  });
}