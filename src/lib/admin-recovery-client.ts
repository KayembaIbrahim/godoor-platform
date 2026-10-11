/**
 * The admin portal lives at `/{ADMIN_PATH_SECRET}/…` and the proxy rewrites it
 * server-side, so the browser's own URL is the only place the secret is
 * readable. Recovery needs to prove the caller came from that address.
 *
 * Falls back to "" when the path does not look like a secret path, which the
 * server treats as "unknown" and refuses.
 */
export function adminSecretFromLocation(): string {
  if (typeof window === "undefined") return "";
  const seg = window.location.pathname.split("/")[1] || "";
  return seg === "app" || seg === "" ? "" : seg;
}

export const SECRET_HEADER = "x-godoor-admin-secret";

/** fetch() wrapper for the recovery endpoint, attaching the admin path secret. */
export function recoveryFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      [SECRET_HEADER]: adminSecretFromLocation(),
      ...(init?.headers || {}),
    },
  });
}