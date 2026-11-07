/**
 * Per-IP rate limiter — in-memory (works per serverless instance).
 * For auth + order/rides. 404-proof, fail-open.
 *
 * WHY IN-MEMORY: Vercel serverless has no shared KV by default — an in-memory
 * map gives per-instance protection, enough against bots and casual abuse.
 * For production multi-instance abuse, move to Upstash KV later. The grant
 * logic is isolated here so the swap is one file.
 *
 * Limits:
 *   auth (POST /api/auth/*): 10 per 15 min per IP (tighter, 5 on signup)
 *   orders/rides writes: 20 per min per IP
 *   general read-heavy: 120 per min per IP
 */

type Bucket = { start: number; count: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

function key(ip: string, route: string): string { return `${ip}:${route}`; }

function prune(now: number) {
  if (buckets.size <= MAX_KEYS) return;
  for (const [k, v] of buckets) if (v.start + 15 * 60 * 1000 < now) buckets.delete(k);
  if (buckets.size > MAX_KEYS) buckets.clear();
}

export function rateLimit(ip: string, route: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  prune(now);
  const k = key(ip, route);
  const b = buckets.get(k);
  if (!b || b.start + windowMs < now) { buckets.set(k, { start: now, count: 1 }); return true; }
  if (b.count >= limit) return false;
  b.count++;
  buckets.set(k, b);
  return true;
}

/** Extract the client IP — cf-connecting-ip first (Cloudflare), then x-real-ip. */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

export function rateLimited(req: Request, route: string, limit = 120, windowMs = 60_000): boolean {
  const ip = clientIp(req);
  return !rateLimit(ip, route, limit, windowMs);
}
