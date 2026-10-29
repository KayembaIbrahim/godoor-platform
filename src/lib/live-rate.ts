/**
 * Live USD to UGX exchange rate fetcher.
 * Uses exchange rate API with in-memory caching for performance.
 */

const EXCHANGE_API_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

let cachedRate: number | null = null;
let cachedAt = 0;

/** Fetched live USD→UGX rate, cached for 1 hour. Falls back gracefully. */
export async function fetchLiveUgxPerUsd(): Promise<number> {
  const now = Date.now();
  if (cachedRate && now - cachedAt < CACHE_TTL_MS) {
    return cachedRate;
  }
  try {
    const res = await fetch(EXCHANGE_API_URL, { next: { revalidate: 3600 } });
    const json = await res.json();
    const rate = json.rates?.UGX;
    if (rate && Number.isFinite(rate)) {
      cachedRate = rate;
      cachedAt = now;
      return rate;
    }
  } catch {
    // network error - fall through to fallback
  }
  // Last-resort hardcoded historical rate
  return 4400;
}

/** Server-side rate for settlement, falls back to DB value then hardcoded. */
export function resolveUgxRate(dbRate?: number | null): number {
  if (dbRate && Number.isFinite(dbRate)) return dbRate;
  return 4400;
}
