/**
 * Shared helpers for admin-entered media links.
 *
 * The admin can either UPLOAD a file (which we publish to our own bucket and
 * link) or PASTE a direct link to media that already lives somewhere else —
 * a CDN, a public Cloudflare R2 bucket, a signed/signed-out URL, a Terabox
 * "direct download" link, and so on. Both are first-class options.
 *
 * ── Why the server still re-validates ──────────────────────────────────────
 * These checks are for the ADMIN'S OWN benefit — an immediate, friendly error
 * instead of a round trip that ends in a generic "Save failed". The
 * authoritative validation lives on the server (`sanitizeImageUrl` /
 * `sanitizeVideoUrl` / `sanitizeArtworkUrl` in the `*-bg-server` modules),
 * because a client-side check can always be bypassed by anyone with devtools.
 * A `javascript:` URL in an admin-authored string is an XSS vector and a
 * `data:` URL would smuggle markup through `background-image`; both are
 * rejected server-side before anything is stored or rendered.
 *
 * ── About Terabox and similar share pages ──────────────────────────────────
 * A Terabox *share page* (`https://terabox.com/s/xxxx`) is an HTML web page,
 * not an image — the browser would fetch HTML and try to paint it as a
 * background, which fails silently. What is needed is the **direct file
 * link** that Terabox's "Direct download" option produces. That is why the
 * admin UI says "direct link" and the helpers below reject obvious web pages
 * rather than letting the admin publish something that will never appear.
 *
 * This module is imported by BOTH client components and server routes, so it
 * must stay free of any server-only dependency.
 */

/** Video extensions we can render in a `<video>` element. */
export const VIDEO_EXTENSIONS = ["mp4", "webm", "ogv", "ogg", "mov"];

/** Image extensions we know how to paint. */
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"];

/**
 * Find the file extension a URL most likely refers to.
 *
 * The PATH is consulted first; only if the path has no extension at all do we
 * look in the query string. That ordering matters:
 *
 *   • `https://cdn.example.com/movies/promo.mp4` → path → `mp4` ✅
 *   • `https://cdn.example.com/d?file=promo.mp4`  → no path ext → query → `mp4` ✅
 *   • `https://evil.example.com/page.html?x=.mp4` → path → `html` ✅ (not video)
 *
 * The last case is why the query is only a fallback: a link that clearly
 * points at an HTML page is a web page, not a media file, whatever its query
 * string claims.
 *
 * Returns "" when no extension can be determined at all — the URL may still be
 * a perfectly good direct file link on a host that uses opaque paths.
 */
export function extensionHint(url: string): string {
  const clean = url.split("#")[0].toLowerCase();
  const queryIndex = clean.indexOf("?");
  const path = queryIndex === -1 ? clean : clean.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : clean.slice(queryIndex + 1);

  const fromPath = lastExtension(path);
  if (fromPath) return fromPath;
  return lastExtension(query);
}

function lastExtension(s: string): string {
  // Greedy over the extension characters, anchored by a boundary so that
  // ".tar.gz" yields "gz" and ".html" yields "html".
  const m = /\.([a-z0-9]{2,5})(?=$|[?&#/])/.exec(s);
  return m ? m[1] : "";
}

/** Does this link point at a video file? */
export function isVideoLink(url: string): boolean {
  return VIDEO_EXTENSIONS.includes(extensionHint(url));
}

/** Does this link point at an image file? */
export function isImageLink(url: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionHint(url));
}

/**
 * Is this a link we can actually paint?
 *
 * `https:` is required (not `http:`, not `javascript:`, not `data:`), and the
 * host must be real. Root-relative paths on this site are also accepted so an
 * admin can point at an asset already in the repo.
 */
export function isUsableMediaLink(raw: string): boolean {
  const url = raw.trim();
  if (!url || url.length > 2048) return false;

  if (url.startsWith("/") && !url.startsWith("//")) {
    return !url.includes("..");
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * A human-readable reason a link was rejected, or "" when it is fine.
 * Used to give the admin a specific message instead of "Invalid URL".
 */
export function explainMediaLink(raw: string): string {
  const url = raw.trim();
  if (!url) return "Paste a link first.";
  if (url.length > 2048) return "That link is too long.";
  if (url.startsWith("javascript:")) return "javascript: links are not allowed.";
  if (url.startsWith("data:")) return "data: links are not allowed.";
  if (url.startsWith("//")) return "Use a full https:// link.";
  if (url.startsWith("/")) {
    return url.includes("..") ? "That path is not allowed." : "";
  }
  if (url.startsWith("http://")) {
    return "Use https:// — http:// links are blocked by the browser on secure pages.";
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "Only https:// links are allowed.";
  } catch {
    return "That does not look like a valid link.";
  }
  return "";
}
