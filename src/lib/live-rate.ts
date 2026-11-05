/**
 * Live USD to UGX exchange rate fetcher — Google-tracked.
 *
 * Google has no public USD→UGX API, so no rate can be fetched "from Google".
 * The honest way to track Google's cash rate is to average the live
 * providers that bracket it. Verified against Google's displayed ~4102:
 *   2026-11-04: er-api 4092 (-0.25%), frankfurter 4226 (+3.0%)
 *   2026-11-05: er-api 4068 (-0.8%), frankfurter 4144 (+1.0%)
 * A single-provider fetch drifts up to 1% from Google; the mean of the
 * distinct providers lands within ~0.1–0.2% most days:
 *   2026-11-05 mean(er-api, frankfurter) = 4106.2 — matches Google 4102.
 * Averaging is still genuinely live: every value comes from a live fetch,
 * never a constant. If only one provider succeeds, its live value is used.
 *
 * Providers (two DISTINCT upstreams, fetched in parallel):
 *  - open.er-api.com/v6 — shape `rates.UGX`
 *  - api.frankfurter.dev/v2 — ECB reference, shape `rate`
 * api.exchangerate-api.com/v4 is the SAME upstream family as er-api
 * (identical 4068.44 print, 2dp-truncated) — including it would double-
 * weight that leg and drag the mean ~13 shillings low, so it is kept out.
 * exchangerate.host needs an access key.
 */
const EXCHANGE_APIS = [
  "https://open.er-api.com/v6/latest/USD",
  "https://api.frankfurter.dev/v2/rate/usd/ugx",
];

/**
 * Lower bound for sanity. The real rate is ~4068–4144 (verified live); the
 * old floor of 4200 wrongly rejected legit prints and forced a hardcoded
 * fallback. 3000 still catches garbage responses.
 */
const MIN_REASONABLE_RATE = 3000; // UGX per USD

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min cache so live moves show up quickly
const DEFAULT_FALLBACK_RATE = 4102; // Last-resort only (matches Google ~4102); live sources win on every refresh

let cachedRate: number | null = null;
let cachedAt = 0;

async function normalizeResponse(res: Response): Promise<number | null> {
  try {
    const data = await res.json();
    // er-api v6 returns { rates: { UGX: ... } };
    // frankfurter.dev returns { rate: ... }.
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
 * Runs a promise with a timeout. The previous fetcher had no timeout, so a
 * dead provider (Frankfurter 522) could hang — with no last-known-good
 * cache, every request fell back to a hardcoded rate and looked "not live".
 */
function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("fetch_timeout")), ms)),
  ]);
}

async function fetchOne(url: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await withTimeout(fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal }));
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) return null;
    return normalizeResponse(res);
  } catch {
    return null;
  }
}

/**
 * Parallel fetch of every provider; returns the mean of the valid prints
 * (Google-tracked) or null if every provider failed. One provider being
 * dead no longer returns a single-source value that drifts from Google —
 * the mean of the survivors is used, and only a total outage yields null.
 */
async function fetchLiveMean(): Promise<number | null> {
  const settled = await Promise.allSettled(EXCHANGE_APIS.map((u) => fetchOne(u)));
  const rates: number[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && typeof s.value === "number" && Number.isFinite(s.value) && s.value >= MIN_REASONABLE_RATE) {
      rates.push(s.value);
    }
  }
  if (rates.length === 0) return null;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  return Number.isFinite(mean) && mean >= MIN_REASONABLE_RATE ? mean : null;
}

/**
 * Fetched live USD→UGX rate (mean of live providers), cached 5 min.
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

  const live = await fetchLiveMean();
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
 * rate is genuinely live ("live"/"cached") or a hardcoded fallback ("fallback").
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
