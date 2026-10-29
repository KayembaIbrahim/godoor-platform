/**
 * Live USD to UGX exchange rate fetcher.
 * Uses multiple free exchange rate APIs with in-memory caching for performance.
 * Falls back gracefully through multiple sources.
 */

const EXCHANGE_APIS = [
  "https://api.exchangerate-api.com/v4/latest/USD",
  "https://api.exchangerate.host/latest?from=USD&to=UGX",
  "https://frankfurter.app/latest?from=USD&to=UGX",
];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const MIN_REASONABLE_RATE = 4200; // Below this, something is wrong with the API
const DEFAULT_FALLBACK_RATE = 4400;

let cachedRate: number | null = null;
let cachedAt = 0;

/** Fetched live USD→UGX rate, cached for 1 hour. Falls back gracefully through multiple APIs. */
export async function fetchLiveUgxPerUsd(): Promise<number> {
  const now = Date.now();
  if (cachedRate && now - cachedAt < CACHE_TTL_MS) {
    return cachedRate;
  }

  // Try each API in sequence
  for (const apiUrl of EXCHANGE_APIS) {
    try {
      const res = await fetch(apiUrl, { next: { revalidate: 3600 } });
      const json = await res.json();

      let rate: number | null = null;

      // Handle different API response formats
      if (apiUrl.includes("exchangerate-api.com")) {
        rate = json.rates?.UGX;
      } else if (apiUrl.includes("open.er-api.com")) {
        rate = json.rates?.UGX;
      } else if (apiUrl.includes("exchangerate.host")) {
        rate = json.rates?.UGX;
      } else if (apiUrl.includes("frankfurter.app")) {
        rate = json.rates?.UGX;
      }

      if (rate && Number.isFinite(rate) && rate >= MIN_REASONABLE_RATE) {
        cachedRate = rate;
        cachedAt = now;
        return rate;
      }

      // If rate is too low, it's likely a mid-market rate that's not realistic for retail
      // Log and continue to next API
      console.warn(`API ${apiUrl} returned rate ${rate} below minimum ${MIN_REASONABLE_RATE}`);
    } catch (e) {
      console.warn(`API ${apiUrl} failed:`, e);
      // Continue to next API
    }
  }

  // All APIs failed or returned unreasonable rates - use last-resort fallback
  cachedRate = DEFAULT_FALLBACK_RATE;
  cachedAt = now;
  return DEFAULT_FALLBACK_RATE;
}

/** Server-side rate for settlement, falls back to DB value then live API then hardcoded. */
export async function resolveUgxRate(dbRate?: number | null): Promise<number> {
  if (dbRate && Number.isFinite(dbRate) && dbRate >= MIN_REASONABLE_RATE) {
    return dbRate;
  }
  // Try live API
  try {
    const liveRate = await fetchLiveUgxPerUsd();
    if (liveRate >= MIN_REASONABLE_RATE) {
      return liveRate;
    }
  } catch {
    // fall through to hardcoded
  }
  return DEFAULT_FALLBACK_RATE;
}