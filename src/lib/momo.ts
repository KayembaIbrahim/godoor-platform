/**
 * Uganda mobile money collection layer.
 *
 * "Requires nothing" for the customer: only their phone + MoMo/Airtel PIN on device.
 * No card, no bank account, no app install beyond what they already have.
 *
 * Modes:
 * 1) DEMO (default) — simulates STK / USSD push; complete with confirm endpoint.
 * 2) LIVE — set env vars for aggregator (Flutterwave / Pesapal / Xyle / MarzPay)
 *    or direct MTN / Airtel collection. Never put secrets in the client.
 *
 * Production env (server only — never VITE_/NEXT_PUBLIC_ for secrets):
 *   MOMO_PROVIDER=demo|flutterwave|pesapal|xyle|mtn|airtel
 *   FLUTTERWAVE_SECRET_KEY=
 *   FLUTTERWAVE_PUBLIC_KEY=
 *   PESAPAL_CONSUMER_KEY=
 *   PESAPAL_CONSUMER_SECRET=
 *   XYLE_API_KEY=
 *   MTN_COLLECTION_SUBSCRIPTION_KEY=
 *   MTN_API_USER=
 *   MTN_API_KEY=
 *   AIRTEL_CLIENT_ID=
 *   AIRTEL_CLIENT_SECRET=
 *   GODOOR_WEBHOOK_SECRET=
 */

import type { Network } from "./wallet-store";

export type CollectionRequest = {
  amountUgx: number;
  phone256: string;
  network: Network;
  reference: string;
  description: string;
};

export type CollectionResult = {
  provider: string;
  providerRef: string;
  status: "pending" | "success" | "failed";
  customerHint: string;
};

function providerMode() {
  return (process.env.MOMO_PROVIDER || "demo").toLowerCase();
}

/**
 * Start a collection (C2B). Customer approves on their phone with PIN.
 * No card. No redirect required for STK-style push.
 */
export async function requestCollection(
  req: CollectionRequest,
): Promise<CollectionResult> {
  const mode = providerMode();

  if (mode === "demo") {
    return {
      provider: "demo",
      providerRef: `DEMO-${req.reference}`,
      status: "pending",
      customerHint:
        req.network === "mtn_momo"
          ? "Approve the MTN MoMo prompt on your phone (or dial *165# if you miss it)."
          : "Approve the Airtel Money prompt on your phone (or check Airtel Money USSD).",
    };
  }

  // Live providers: wire HTTP here when credentials exist.
  // Architecture is ready; without keys we fail closed with a clear message.
  if (mode === "flutterwave") {
    const secret = process.env.FLUTTERWAVE_SECRET_KEY || "";
    if (!secret) {
      throw new Error(
        'Mobile money provider "flutterwave" is not configured. Set FLUTTERWAVE_SECRET_KEY, or use demo.',
      );
    }
    // Flutterwave v3 mobile-money-Uganda charge (MTN MoMo / Airtel UG).
    // Docs: https://developer.flutterwave.com/reference/mobile-money-uganda
    const res = await fetch("https://api.flutterwave.com/v3/charges?type=mobile_money_uganda", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: req.reference,
        amount: req.amountUgx,
        currency: "UGX",
        email: "customer@godoor.site",
        phone_number: req.phone256,
        network: req.network === "mtn_momo" ? "MTN" : "AIRTEL",
        redirect_url: "https://godoor.site/wallet",
        client_ip: "154.123.173.10",
        device_fingerprint: req.reference,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Flutterwave charge failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json().catch(() => null)) as {
      data?: { flw_ref?: string; tx_ref?: string; status?: string };
    } | null;
    const providerRef = json?.data?.flw_ref || json?.data?.tx_ref || req.reference;
    return {
      provider: "flutterwave",
      providerRef,
      status: "pending",
      customerHint: "Approve the payment prompt on your phone to complete the top-up.",
    };
  }

  if (mode === "pesapal") {
    const key = process.env.PESAPAL_CONSUMER_KEY || "";
    const secret = process.env.PESAPAL_CONSUMER_SECRET || "";
    if (!key || !secret) {
      throw new Error(
        'Mobile money provider "pesapal" is not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET, or use demo.',
      );
    }
    // Pesapal v3: auth then SubmitOrderRequest (UGX, MTN/Airtel). Full
    // redirect/IPN confirmation happens in /api/momo/webhook — never the browser.
    const authRes = await fetch("https://pay.pesapal.com/v3/api/Auth/RequestToken", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ consumer_key: key, consumer_secret: secret }),
    });
    if (!authRes.ok) throw new Error(`Pesapal auth failed (${authRes.status})`);
    const auth = (await authRes.json().catch(() => null)) as { token?: string } | null;
    if (!auth?.token) throw new Error("Pesapal auth returned no token");
    const orderRes = await fetch("https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        id: req.reference,
        currency: "UGX",
        amount: req.amountUgx,
        description: req.description.slice(0, 100),
        callback_url: "https://godoor.site/api/momo/webhook",
        notification_id: process.env.PESAPAL_IPN_ID || "",
        phone_number: req.phone256,
        payment_method: req.network === "mtn_momo" ? "MTN" : "AIRTEL",
      }),
    });
    if (!orderRes.ok) {
      const text = await orderRes.text().catch(() => "");
      throw new Error(`Pesapal order failed (${orderRes.status}): ${text.slice(0, 200)}`);
    }
    const order = (await orderRes.json().catch(() => null)) as {
      order_tracking_id?: string;
      merchant_reference?: string;
    } | null;
    return {
      provider: "pesapal",
      providerRef: order?.order_tracking_id || order?.merchant_reference || req.reference,
      status: "pending",
      customerHint: "Complete the mobile-money prompt to finish the top-up.",
    };
  }

  throw new Error(
    `Mobile money provider "${mode}" is not configured. Set MOMO_PROVIDER and credentials, or use demo.`,
  );
}

/**
 * Verify a collection (webhook or poll). In demo, client can call confirm.
 * Live: only trust signed webhooks or provider status API — never the browser alone.
 */
export async function verifyCollection(providerRef: string): Promise<{
  paid: boolean;
  amountUgx?: number;
}> {
  if (providerRef.startsWith("DEMO-")) {
    // Demo does not auto-verify — explicit confirmTopup is required.
    return { paid: false };
  }
  const mode = providerMode();
  // Live verification: only trust the provider status API — never the browser.
  if (mode === "flutterwave" && process.env.FLUTTERWAVE_SECRET_KEY) {
    try {
      // providerRef may be flw_ref or tx_ref; try tx verification endpoint.
      const res = await fetch(
        `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(providerRef)}/verify`,
        { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } },
      );
      if (!res.ok) return { paid: false };
      const json = (await res.json().catch(() => null)) as {
        data?: { status?: string; amount?: number; currency?: string };
      } | null;
      if (json?.data?.status === "successful" && json.data.currency === "UGX") {
        return { paid: true, amountUgx: Number(json.data.amount) || undefined };
      }
    } catch {
      return { paid: false };
    }
    return { paid: false };
  }
  return { paid: false };
}

/**
 * Verify an incoming provider webhook signature. Fail-closed: unknown or
 * mismatched signatures return false and the caller must ignore the payload.
 * Flutterwave sends `verif-hash` (your secret hash); Pesapal signs IPN calls
 * server-to-server which we re-query; generic HMAC uses GODOOR_WEBHOOK_SECRET.
 */
export async function verifyWebhookSignature(req: Request, rawBody: string): Promise<boolean> {
  const mode = providerMode();
  if (mode === "flutterwave") {
    const secret = process.env.FLUTTERWAVE_SECRET_KEY || "";
    const sent = req.headers.get("verif-hash") || req.headers.get("verif_hash") || "";
    return Boolean(secret && sent && sent === secret);
  }
  const hookSecret = process.env.GODOOR_WEBHOOK_SECRET || "";
  const sig = req.headers.get("x-godoor-signature") || "";
  if (!hookSecret || !sig) return false;
  try {
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expected = createHmac("sha256", hookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const NETWORK_LABEL: Record<Network, string> = {
  mtn_momo: "MTN Mobile Money",
  airtel_money: "Airtel Money",
};

/**
 * The GoDoor business mobile-money number customers send top-ups to.
 * Configure once via env on the server; shown to customers and to the admin.
 * Returns only the display form — nothing secret.
 */
export function collectionConfig(): { number: string; name: string } {
  const number = (process.env.MOMO_COLLECTION_NUMBER || "").trim();
  const name = (process.env.MOMO_COLLECTION_NAME || "GoDoor Business").trim();
  if (!number) throw new Error("Business money number not configured yet.");
  return { number, name };
}

/** Morse partner wallet: customers top up their own Morse wallet from mobile
 *  money, then send USD (Morse shows it as the local UGX amount) to the GoDoor
 *  Morse username (@Godoor). Morse→Morse transfers are plain USD — no crypto
 *  chain needed. The admin sees the incoming transfer in the Morse app and
 *  credits the user's wallet from the admin portal. The referral code earns
 *  GoDoor Morse partnership developer funds on every signup. */
/** `rateUgx` = how many UGX one USD covers when paying orders from the GoDoor
 *  gas-fee balance (default 3800). Admin can tune it via `USDT_TO_UGX_RATE`. */
let cachedRateUgx = 0;
let cachedRateAt = 0;
const RATE_TTL_MS = 6 * 60 * 60 * 1000; // refresh at most every 6h
const FX_SOURCE = "https://open.er-api.com/v6/latest/USD";

/** Env-configured rate (explicit admin override) or 0 when unset. */
function envRateUgx(): number {
  const r = Number(process.env.USDT_TO_UGX_RATE);
  return r > 0 ? Math.round(r) : 0;
}

/** Default UGX per USD when no env override and no live rate available. */
export const DEFAULT_RATE_UGX = 3800;

/** Live USD→UGX rate, fetched on demand from a free FX source and cached for
 *  6h. Falls back to the env override, then to `DEFAULT_RATE_UGX`. Never
 *  throws — money math downstream keeps working even if FX is unreachable. */
export async function refreshRateUgx(): Promise<number> {
  if (cachedRateUgx > 0 && Date.now() - cachedRateAt < RATE_TTL_MS) return cachedRateUgx;
  const fallback = envRateUgx() || DEFAULT_RATE_UGX;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(FX_SOURCE, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      const ugx = Number(json.rates?.UGX);
      if (ugx > 0 && ugx < 1_000_000) {
        cachedRateUgx = Math.round(ugx);
        cachedRateAt = Date.now();
        return cachedRateUgx;
      }
    }
  } catch {}
  cachedRateUgx = fallback;
  cachedRateAt = Date.now();
  return cachedRateUgx;
}

/** Best-known UGX-per-USD right now (cached/live, else env, else default). */
export function rateUgx(): number {
  if (cachedRateUgx > 0) return cachedRateUgx;
  return envRateUgx() || DEFAULT_RATE_UGX;
}

export function usdtConfig(): {
  handle: string;
  address: string;
  network: string;
  referralCode: string;
  downloadUrl: string;
  rateUgx: number;
} {
  const handle = (process.env.MORSE_USERNAME || "@Godoor").trim();
  const address = (process.env.USDT_WALLET_ADDRESS || "").trim();
  const rate = rateUgx();
  return {
    handle,
    address,
    network: "Morse",
    referralCode: (process.env.MORSE_REFERRAL_CODE || "AsAp4f").trim(),
    downloadUrl: (process.env.MORSE_DOWNLOAD_URL || "https://morsemoney.com/download").trim(),
    rateUgx: rate,
  };
}
