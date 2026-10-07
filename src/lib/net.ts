// ─── Network deadlines ─────────────────────────────────────────
// Every read used to `await fetch(...)` with no timeout. On a flaky 4G
// connection a stalled request never settles, so the promise never resolves
// and the screen sits in its loading state forever. These helpers bound any
// operation so the UI always gets a definite answer.
//
// This lives in its own module (not db.ts) so that low-level consumers —
// geocoding, IP fallback, map tiles — can bound a request without importing
// the whole database layer.

/** Default budget for a single read. Generous enough for 3G, short enough
 *  that a user sees content well before they'd hit the back button. */
export const READ_TIMEOUT_MS = 8000;

/** Budget for third-party geocoding / IP-lookup services. Slower than our own
 *  API and outside our control, so it gets a little more room. */
export const GEO_TIMEOUT_MS = 6000;

/** Reject with a timeout error if `p` hasn't settled within `ms`.
 *  Accepts any PromiseLike — supabase-js query builders are thenables, not
 *  native Promises, so a Promise<T>-only signature would reject them. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** fetch() with a hard deadline, so a hung socket can't strand a screen. */
export function fetchTimed(
  input: string,
  init?: RequestInit,
  ms: number = READ_TIMEOUT_MS,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return fetch(input, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/** Run `fns` in order, returning the first result that passes `ok`.
 *
 *  Used for third-party lookup chains (IP geolocation, geocoding). Every
 *  attempt is bounded, so a provider that never responds costs one timeout
 *  rather than hanging the whole chain. Returns null if all attempts fail. */
export async function firstOf<T>(
  fns: Array<() => Promise<T | null>>,
  ok: (v: T) => boolean,
  ms: number,
  label: string,
): Promise<T | null> {
  for (const fn of fns) {
    try {
      const v = await withTimeout(fn(), ms, label);
      if (v !== null && ok(v)) return v;
    } catch {
      // Timed out or errored — try the next provider.
    }
  }
  return null;
}

// ─── Global deadline ───────────────────────────────────────────
//
// The codebase has ~150 `fetch(...)` call sites, almost none of which pass a
// deadline. Hand-editing each one is the higher-risk path, so instead the
// browser's `fetch` is wrapped once at startup: every request gets a default
// deadline unless the caller opts out.
//
// The wrapper composes with any signal the caller already set — several call
// sites pass their own AbortController — so nothing loses the ability to
// cancel early.
//
// Server-side fetch is deliberately NOT wrapped: a route handler talking to
// Supabase or Flutterwave should keep its own semantics.

/** Default ceiling applied to browser fetch calls that don't opt out. */
export const FETCH_DEADLINE_DEFAULT_MS = 20_000;

/** Opt a request out of the global deadline.
 *
 *  Use for genuinely long operations — file uploads on a metered 3G
 *  connection, where a fixed 20s ceiling would fail a legitimate upload.
 *  Used as a property on the `init` object; it is stripped before the
 *  request is dispatched. */
export const NO_FETCH_DEADLINE = Symbol("godoor:no-fetch-deadline");

/** Wrap a request init so it is exempt from the global deadline.
 *
 *  `noDeadline({ method: "POST", body: fd })` — for file uploads on a metered
 *  3G connection, where a fixed ceiling would fail a legitimate upload. */
export function noDeadline(init: RequestInit = {}): RequestInit {
  return { ...init, [NO_FETCH_DEADLINE]: true } as RequestInit;
}

const INSTALLED = Symbol.for("godoor:fetch-deadline-installed");

/** Install the deadline wrapper. Idempotent — safe under HMR/re-render.
 *  Call once from a client component that mounts on every page. */
export function installFetchDeadline(ms: number = FETCH_DEADLINE_DEFAULT_MS): void {
  // Server renders must keep native fetch semantics.
  if (typeof window === "undefined") return;
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  const original = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = (init ?? {}) as RequestInit & { [NO_FETCH_DEADLINE]?: boolean };

    // Opt-out: strip the marker, dispatch untouched.
    if (raw[NO_FETCH_DEADLINE]) {
      const { [NO_FETCH_DEADLINE]: _drop, ...rest } = raw;
      return original(input, rest);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException(`Request exceeded ${ms}ms`, "TimeoutError"));
    }, ms);

    // Compose with a caller-supplied signal rather than replacing it, so
    // manual cancellation (e.g. a geocode superseded by a newer keystroke)
    // still works — it just also trips our timer as a backstop.
    const upstream = init?.signal ?? null;
    if (upstream) {
      if (upstream.aborted) {
        controller.abort((upstream as AbortSignal & { reason?: unknown }).reason);
      } else {
        upstream.addEventListener(
          "abort",
          () => controller.abort((upstream as AbortSignal & { reason?: unknown }).reason),
          { once: true },
        );
      }
    }

    const { [NO_FETCH_DEADLINE]: _ignored, ...forward } = raw;
    return original(input, { ...forward, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
    });
  };
}

