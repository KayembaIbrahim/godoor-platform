/**
 * Regenerates every GoDoor brand asset from the single source logo.
 *
 * Source: assets/brand/godoor-logo-source.png (transparent PNG, navy + orange).
 * Run:    node scripts/build-brand-assets.mjs
 *
 * The source logo is navy (#011438) on transparency, so it disappears on the
 * app's dark canvas. Rather than shipping two hand-made logos, every dark
 * variant is produced here by lifting the navy pixels to a near-white while
 * leaving the brand orange untouched.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "assets/brand/godoor-logo-source.png");
const OUT = resolve(ROOT, "public/brand");

/** Brand colours sampled from the source logo. */
const NAVY = { r: 1, g: 20, b: 56 }; // #011438
const ORANGE = { r: 253, g: 85, b: 1 }; // #FD5501
const INK_DARK = { r: 248, g: 250, b: 252 }; // near-white for the dark theme
const INK_LIGHT = { r: 255, g: 255, b: 255 }; // white for marks on navy

/**
 * Source geometry, measured once with a column ink profile: the widest run of
 * fully transparent columns separates the mark from the wordmark.
 */
const CONTENT = { left: 105, top: 115, right: 2087, bottom: 608 };
const MARK = { left: 105, top: 115, right: 575, bottom: 608 };
const WORD = { left: 641, top: 221, right: 2087, bottom: 519 };
/** Widest transparent gap inside the wordmark, i.e. the "Go" | "Door" split. */
const WORD_GAPS = [938, 1177, 1455, 1693, 1931];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * How navy-ish a pixel is, in [0,1]. Navy reads blue-dominant (b - r ~ +55),
 * orange reads red-dominant (~ -252), so a single channel delta separates
 * them cleanly and antialiased edges to transparency keep their alpha.
 */
function navyWeight(r, g, b) {
  return clamp((b - r + 24) / 56, 0, 1);
}

/** Recolours the navy toward `ink`, preserving the orange and the alpha. */
function liftNavy(raw, ink) {
  const out = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i < raw.length; i += 4) {
    const t = navyWeight(raw[i], raw[i + 1], raw[i + 2]);
    out[i] = Math.round(raw[i] + (ink.r - raw[i]) * t);
    out[i + 1] = Math.round(raw[i + 1] + (ink.g - raw[i + 1]) * t);
    out[i + 2] = Math.round(raw[i + 2] + (ink.b - raw[i + 2]) * t);
    out[i + 3] = raw[i + 3];
  }
  return out;
}

async function crop(buffer, box) {
  return sharp(buffer).extract({
    left: box.left,
    top: box.top,
    width: box.right - box.left + 1,
    height: box.bottom - box.top + 1,
  });
}

async function emit(name, pipeline) {
  const target = resolve(OUT, name);
  await pipeline.png({ compressionLevel: 9 }).toFile(target);
  console.log(`  ${name.padEnd(28)} ok`);
  return target;
}

/** Recolours then re-emits a cropped region at an optional width. */
async function emitRecolored(name, box, ink, width) {
  const region = await crop(await sharp(SOURCE).png().toBuffer(), box);
  const { data, info } = await region.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const recolored = liftNavy(data, ink);
  let pipe = sharp(recolored, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (width) pipe = pipe.resize({ width });
  return emit(name, pipe);
}

/**
 * Renders the mark on a solid navy plate, sized so the artwork sits inside the
 * requested share of the canvas. `safe` is the fraction of the icon the mark
 * may occupy — lower for maskable icons, which can be cropped to a circle.
 */
async function emitPlate(name, size, plate, markHeightShare, safe = 0.78) {
  const mark = await sharp(await sharp(SOURCE).png().toBuffer())
    .extract({
      left: MARK.left,
      top: MARK.top,
      width: MARK.right - MARK.left + 1,
      height: MARK.bottom - MARK.top + 1,
    })
    .toBuffer();
  const { data, info } = await sharp(mark).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const recolored = liftNavy(data, INK_LIGHT);
  const target = Math.round(size * markHeightShare);
  const scaled = await sharp(recolored, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize({ height: target })
    .png()
    .toBuffer();
  return emit(
    name,
    sharp({ create: { width: size, height: size, channels: 4, background: plate } }).composite([
      { input: scaled, gravity: "centre" },
    ])
  );
}

mkdirSync(OUT, { recursive: true });
console.log("Building GoDoor brand assets\n");

// ── Lockups and marks (light + dark theme) ────────────────────────────────────
console.log(" lockups & marks");
await emitRecolored("godoor-logo.png", CONTENT, NAVY, 1200); // navy stays navy
await emitRecolored("godoor-logo-dark.png", CONTENT, INK_DARK, 1200);
await emitRecolored("godoor-mark.png", MARK, NAVY);
await emitRecolored("godoor-mark-dark.png", MARK, INK_DARK);

// ── Square app icons on a navy plate ─────────────────────────────────────────
console.log(" app icons");
await emitPlate("icon-192.png", 192, NAVY, 0.56);
await emitPlate("icon-512.png", 512, NAVY, 0.56);
await emitPlate("icon-maskable-512.png", 512, NAVY, 0.44);
await emitPlate("apple-touch-icon.png", 180, NAVY, 0.58);

// ── Favicon: a crisp 32px render plus a scalable SVG wrapper ────────────────
console.log(" favicon");
await emitPlate("favicon-32.png", 32, NAVY, 0.62);

// The favicon SVG wraps a raster mark, so the embed is deliberately small:
// 2x the 52px artwork box, palette-quantised, to keep the SVG a few KB rather
// than shipping the full-resolution mark inline.
const EMBED_PX = 128;
const markForSvg = await sharp(await sharp(SOURCE).png().toBuffer())
  .extract({
    left: MARK.left,
    top: MARK.top,
    width: MARK.right - MARK.left + 1,
    height: MARK.bottom - MARK.top + 1,
  })
  .resize({ height: EMBED_PX })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const whiteMarkPng = await sharp(liftNavy(markForSvg.data, INK_LIGHT), {
  raw: { width: markForSvg.info.width, height: markForSvg.info.height, channels: 4 },
})
  .png({ palette: true, colours: 32, effort: 10, compressionLevel: 9 })
  .toBuffer();

const markAspect = (MARK.bottom - MARK.top + 1) / (MARK.right - MARK.left + 1);
const BOX = 52;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="GoDoor">
  <rect width="64" height="64" rx="14" fill="#011438"/>
  <image x="6" y="6" width="${BOX}" height="${(BOX * markAspect).toFixed(2)}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${whiteMarkPng.toString("base64")}"/>
</svg>
`;
writeFileSync(resolve(ROOT, "public/favicon.svg"), svg);
console.log("  favicon.svg                  ok");

// ── Open Graph card ──────────────────────────────────────────────────────────
// Rendered here rather than in a route handler so the card is a static asset
// that works in every context (including crawlers that never run JS). Text is
// rasterised with the metric-compatible Liberation Sans that ships in CI.
console.log(" open graph");
const lockupRegion = await crop(await sharp(SOURCE).png().toBuffer(), CONTENT);
const ogRaw = await lockupRegion.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const OG_WIDTH = 700;
const ogLockupPng = await sharp(liftNavy(ogRaw.data, INK_LIGHT), {
  raw: { width: ogRaw.info.width, height: ogRaw.info.height, channels: 4 },
})
  .resize({ width: OG_WIDTH })
  .png()
  .toBuffer();

const LOCKUP_TOP = 196;

const FONT = "Liberation Sans, DejaVu Sans, Arial, sans-serif";
const ogBackdrop = Buffer.from(
  `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#011438"/>
    <circle cx="1090" cy="70" r="300" fill="#FD5501" opacity="0.10"/>
    <circle cx="90" cy="610" r="240" fill="#FD5501" opacity="0.07"/>
    <text x="600" y="452" text-anchor="middle" font-family="${FONT}" font-size="46" font-weight="700" fill="#FFFFFF" letter-spacing="1">Your City. Your Door.</text>
    <text x="600" y="500" text-anchor="middle" font-family="${FONT}" font-size="23" font-weight="400" fill="#FD8A4B" letter-spacing="0.5">Deliveries, Boda rides and mobile-money payments across Uganda</text>
    <rect x="500" y="540" width="200" height="4" rx="2" fill="#FD5501" opacity="0.85"/>
  </svg>`
);

writeFileSync(
  resolve(ROOT, "src/app/opengraph-image.png"),
  await sharp(ogBackdrop)
    .composite([{ input: ogLockupPng, left: Math.round((1200 - OG_WIDTH) / 2), top: LOCKUP_TOP }])
    .png()
    .toBuffer()
);
console.log("  src/app/opengraph-image.png  ok");
writeFileSync(
  resolve(ROOT, "src/app/opengraph-image.alt.txt"),
  "GoDoor — Your City. Your Door. Deliveries, Boda rides and mobile-money payments across Uganda.\n"
);
console.log("  opengraph-image.alt.txt      ok");
