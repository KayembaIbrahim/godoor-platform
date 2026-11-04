/**
 * Live USD to UGX exchange rate fetcher.
 * Uses multiple free exchange rate APIs with in-memory caching for performance.
 * Falls back gracefully through multiple sources.
 *
 * Live providers, tried in order (verified 2026-11-05):
 *  - open.er-api.com/v6 — alive, UGX=4092, shape `rates.UGX`  → PRIMARY (fastest/most reliable)
 *  - api.exchangerate-api.com/v4 — alive, UGX=4092, shape `rates.UGX`
 *  - api.frankfurter.dev — alive but occasionally flaky (was 522 on 2026-11-04,
 *    returned 4225 on 2026-11-05). Put last so a flaky source can't short-circuit
 *    the two reliable ones. Shape `rate` (single pair) — handled by normalizeResponse.
 * exchangerate.host needs an access key.
 */
const EXCHANGE_APIS = [
  "https://open.er-api.com/v6/latest/USD",
  "https://api.exchangerate-api.com/v4/latest/USD?base=USD&symbols=UGX",
  "https://api.frankfurter.dev/v2/rate/usd/ugx",
];

/**
 * Lower bound for sanity. The real rate is ~4092 (verified live); the old
 * floor of 4200 wrongly rejected it. 3500 still catches garbage responses.
 */
const MIN_REASONABLE_RATE = 3000; // UGX per USD — well below the real ~4092/4225 so a legit dip to 4092 is never rejected (old 4200 floor wrongly rejected it and forced the 4400 hardcoded fallback)

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const DEFAULT_FALLBACK_RATE = 4400;

let cachedRate: number | null = null;
let cachedAt = 0;

async function normalizeResponse(res: Response): Promise<number | null> {
  try {
    const data = await res.json();
    // er-api v6 + exchangerate-api v4 both return { rates: { UGX: ... } };
    // frankfurter.dev returns { rates: { UGX: ... } } as well.
    if (typeof data === "object" && data !== null) {
      const rates = (data as { rates?: unknown }).rates;
      if (typeof rates === "object" && rates !== null) {
        const rate = (rates as Record<string, unknown>).UGX ?? (rates as Record<string, unknown>).ugx;
        if (typeof rate === "number" && Number.isFinite(rate) && rate >= MIN_REASONABLE_RATE) {
          return rate;
        }
      }
      const single = (data as { rate?: unknown }).rate;
      if (typeof single === "number" && Number.isFinite(single) && single >= MIN_REASONABLE_RATE) {
        return single;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Runs a promise with a timeout. The previous fetcher had no timeout, so the dead
 * Frankfurter 522 could hang — with no last-known-good cache, every request fell
 * back to the hardcoded 4400 and looked "not live".
 */
function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("fetch_timeout")), ms)),
  ]);
}

async function fetchFromApis(): Promise<number | null> {
  for (const url of EXCHANGE_APIS) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await withTimeout(fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal }));
      } finally {
        clearTimeout(t);
      }
      if (!res.ok) continue;
      const rate = await normalizeResponse(res);
      if (rate !== null) return rate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetched live USD→UGX rate, cached for 1 hour. Falls back through multiple APIs.
 * IMPORTANT: never cache DEFAULT_FALLBACK_RATE as a "good" value — only live,
 * validated rates are stored. If all providers fail, return the last-known-good
 * live rate if one exists; only then fall back to DEFAULT_FALLBACK_RATE. This
 * stops a cold-start server from hard-coding a fallback rate in cache and
 * serving it forever as if it were live.
 */
export async function fetchLiveUgxPerUsd(): Promise<{ rate: number; source: "live" | "cached" | "fallback" }> {
  const now = Date.now();
  if (cachedRate !== null && now - cachedAt < CACHE_TTL_MS) {
    return { rate: cachedRate, source: "cached" };
  }

  const live = await fetchFromApis();
  if (live !== null) {
    cachedRate = live;
    cachedAt = now;
    return { rate: cachedRate, source: "live" };
  }
  // All providers failed since last fetch. Keep serving the last-known-good
  // live rate (if any) until it expires; do NOT overwrite it with the fallback.
  if (cachedRate !== null) {
    cachedAt = now; // extend; keeps serving prior good value
    return { rate: cachedRate, source: "cached" };
  }
  // Never fetched live successfully this process. Do not cache the fallback:
  // the next request must retry the providers, not serve a hardcoded rate.
  return { rate: DEFAULT_FALLBACK_RATE, source: "fallback" };
}

/**
 * Server-side rate for settlement, falls back to DB value then live API then
 * hardcoded. Returns `{ rate, source }` so display paths can show whether the
 * rate is genuinely live ("live"/"cached") or a hardcoded fallback ("fallback"),
 * instead of presenting 4400 as if it were live.
 */
export async function resolveUgxRate(dbRate?: number | null): Promise<{ rate: number; source: "live" | "cached" | "fallback" }> {
  if (dbRate && Number.isFinite(dbRate) && dbRate >= MIN_REASONABLE_RATE) {
    return { rate: dbRate, source: "fallback" };
  }
  try {
    const { rate, source } = await fetchLiveUgxPerUsd();
    if (rate >= MIN_REASONABLE_RATE) {
      return { rate, source };
    }
  } catch {
    // fall through
  }
  return { rate: DEFAULT_FALLBACK_RATE, source: "fallback" };
}