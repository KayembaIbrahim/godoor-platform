/**
 * Verifies the media-url helpers against the exact URLs the admin pages
 * produce. Before the fix, `extensionHint` read the HOST's TLD as the file
 * extension, so every uploaded file was classified as "not an image, not a
 * video" — on the client AND on the server.
 *
 * Run: node scripts/verify-media-url.mts
 */
import { extensionHint, isVideoLink, isImageLink } from "../src/lib/media-url";

const SUPABASE = "https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public";
const cases: Array<[string, string, string]> = [
  // [url, expected extension, kind]
  [`${SUPABASE}/catalogue-images/welcome/clip.mp4`, "mp4", "video"],
  [`${SUPABASE}/catalogue-images/welcome/clip.webm`, "webm", "video"],
  [`${SUPABASE}/catalogue-images/welcome/clip.mov`, "mov", "video"],
  [`${SUPABASE}/catalogue-images/greeting/hero.png`, "png", "image"],
  [`${SUPABASE}/catalogue-images/greeting/hero.jpg`, "jpg", "image"],
  [`${SUPABASE}/catalogue-images/greeting/hero.jpeg`, "jpeg", "image"],
  [`${SUPABASE}/catalogue-images/greeting/hero.webp`, "webp", "image"],
  [`${SUPABASE}/catalogue-images/greeting/hero.gif`, "gif", "image"],
  [`${SUPABASE}/catalogue-images/greeting/hero.svg`, "svg", "image"],
  // The exact shape that used to break: the host's TLD is the first dot-segment.
  ["https://cdn.example.com/movies/promo.mp4", "mp4", "video"],
  ["https://godoor.site/brand/welcome.jpg", "jpg", "image"],
  ["https://example.com/a/b/c/poster.WEBP", "webp", "image"],
  // A signed Supabase URL (query string, extension still in the path).
  [`${SUPABASE}/welcome/clip.mp4?token=abc123&x=1`, "mp4", "video"],
  // A web page must NOT be mistaken for media.
  ["https://terabox.com/s/abc123", "", "none"],
  ["https://example.com/page.html", "html", "none"],
];

let failures = 0;
console.log("── extensionHint ──");
for (const [url, expected] of cases) {
  const got = extensionHint(url);
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${expected || "(none)"}".padEnd(9)} got "${got}"  ${url.slice(0, 78)}`);
}

console.log("\n── isVideoLink / isImageLink ──");
for (const [url, , kind] of cases) {
  const v = isVideoLink(url);
  const i = isImageLink(url);
  const wantV = kind === "video";
  const wantI = kind === "image";
  const ok = v === wantV && i === wantI;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  video=${v} image=${i} (want video=${wantV} image=${wantI})  ${url.slice(0, 66)}`);
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
