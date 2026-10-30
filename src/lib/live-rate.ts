/**
 * Live USD to UGX exchange rate fetcher.
 * Uses multiple free exchange rate APIs with in-memory caching for performance.
 * Falls back gracefully through multiple sources.
 */

const EXCHANGE_APIS = [
  "https://api.frankfurter.dev/v2/rate/usd/ugx",
  "https://api.exchangerate-api.com/v4/latest/USD?base=USD&symbols=UGX",
  "https://api.exchangerate.host/latest?from=USD&to=UGX",
];

// Lower bounds for sanity — below this, something is wrong with the source
const MIN_REASONABLE_RATE = 4200; // UGX per USD

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const DEFAULT_FALLBACK_RATE = 4400;

let cachedRate: number | null = null;
let cachedAt = 0;

function normalizeResponse(res: Response): number | null {
  try {
    const data = await res.json();
    // frankfurter.dev returns { rates: { UGX: ... } }
    // exchangerate-api / exchangerate.host may return different shapes
    if (typeof data === "object" && data !== null && typeof data === "object") {
      if ("rates" in data && typeof data.rates === "object") {
        const rate = data.rates.UGX ?? data.rates.ugx;
        if (typeof rate === "number" && Number.isFinite(rate) && rate >= MIN_REASONABLE_RATE) {
          return rate;
        }
      }
      if (typeof data.rate === "number" && Number.isFinite(data.rate) && data.rate >= MIN_REASONABLE_RATE) {
        return data.rate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchFromApis(): Promise<number | null> {
  for (const url of EXCHANGE_APIS) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const rate = normalizeResponse(res);
      if (rate !== null) return rate;
    } catch {
      continue;
    }
  }
  return null;
}

/** Fetched live USD→UGX rate, cached for 1 hour. Falls back through multiple APIs. */
export async function fetchLiveUgxPerUsd(): Promise<number> {
  const now = Date.now();
  if (cachedRate && now - cachedAt < CACHE_TTL_MS) {
    return cachedRate;
  }

  const live = await fetchFromApis();
  cachedRate = live ?? DEFAULT_FALLBACK_RATE;
  cachedAt = now;
  return cachedRate;
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