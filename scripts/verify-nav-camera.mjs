/**
 * Navigation-camera verification.
 *
 * The complaint this answers: "the map navigation gets too compacted which
 * makes navigation difficult with the rider".
 *
 * The old camera sat exactly on the rider at a fixed zoom with no tilt, so the
 * rider was pinned to the middle of a small circle of road and the road AHEAD
 * — the only thing a driver needs — was off the top of the screen. This drives
 * the real map in a real browser and measures:
 *
 *   1. the rider is NOT dead centre (the camera was pushed forward);
 *   2. the camera is tilted (a windscreen view, not a flat overhead);
 *   3. the camera looks FURTHER AHEAD than the old flat camera did;
 *   4. the zoom tracks the distance to the next turn — in when it is close,
 *      back when it is far — and never tighter than the base;
 *   5. the top overlay occupies ONE row, not two, so it stops eating the map.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3111";
const RIDER = { lat: 0.3163, lng: 32.5822 };

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}

const browser = await chromium.launch({
  args: [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--single-process",
    "--disable-features=IsolateOrigins,site-per-process",
    "--renderer-process-limit=1",
    "--js-flags=--max-old-space-size=384",
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

console.log(`→ ${BASE}/nav-harness`);
await page.goto(`${BASE}/nav-harness`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => !!window.__godoorMapState, null, { timeout: 60_000 });
await page.waitForTimeout(3500);

/** Camera + rider screen position, measured from the live map. */
async function measure() {
  return page.evaluate((rider) => {
    const m = window.__godoorMap;
    const state = window.__godoorMapState();
    const p = m.project([rider.lng, rider.lat]);
    const canvas = m.getCanvas();
    return {
      ...state,
      riderScreen: { x: p.x, y: p.y },
      canvasCss: { w: canvas.clientWidth, h: canvas.clientHeight },
    };
  }, RIDER);
}

/** Metres of ground visible per screen pixel at the camera's current zoom. */
function metresPerPixel(lat, zoom) {
  return (40075017 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
}

console.log("\n── Navigation camera ──");
const base = await measure();

check(
  "the map rendered",
  !!base && base.zoom > 0,
  base ? `zoom ${base.zoom.toFixed(2)}` : "no camera"
);
check(
  "the camera is tilted (windscreen view, not a flat overhead)",
  base.pitch >= 30,
  `pitch ${base.pitch.toFixed(1)}°`
);
check(
  "the map is heading-up (bearing matches the rider's heading of 0°)",
  Math.abs(base.bearing) < 5,
  `bearing ${base.bearing.toFixed(1)}°`
);

/* The rider must sit BELOW the vertical centre — that is the whole point of
   pushing the camera forward. */
const riderFrac = base.riderScreen.y / base.canvasCss.h;
check(
  "the rider sits BELOW the centre, so the road ahead fills the upper half",
  riderFrac > 0.52,
  `rider at ${(riderFrac * 100).toFixed(0)}% down the screen`
);
check(
  "the rider is still on screen",
  riderFrac < 0.95 && base.riderScreen.y > 0,
  `rider at y=${base.riderScreen.y.toFixed(0)} of ${base.canvasCss.h}`
);

/* The camera centre must be AHEAD of the rider (north here, bearing 0). */
const aheadMetres = (base.center.lat - RIDER.lat) * 111320;
check(
  "the camera centre is pushed forward along the heading",
  aheadMetres > 10,
  `${aheadMetres.toFixed(0)} m ahead of the rider`
);

/* How much ground is visible ahead now, versus the old flat centred camera? */
const visibleAheadNow = (base.canvasCss.h * 0.5) * metresPerPixel(RIDER.lat, base.zoom)
  / Math.max(Math.cos((base.pitch * Math.PI) / 180), 0.35);
const visibleAheadOld = (base.canvasCss.h * 0.5) * metresPerPixel(RIDER.lat, 16.5);
check(
  "the camera sees materially further ahead than the old flat centred one",
  visibleAheadNow > visibleAheadOld * 1.4,
  `now ${visibleAheadNow.toFixed(0)} m vs old ${visibleAheadOld.toFixed(0)} m`
);

console.log("\n── Adaptive zoom tracks the next turn ──");
const zoomForTurn = async (metres) => {
  await page.evaluate((m) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === `turn ${m} m`
    );
    btn?.click();
  }, metres);
  await page.waitForTimeout(2500);
  return measure();
};

const zClose = await zoomForTurn(20);
const zMid = await zoomForTurn(400);
const zFar = await zoomForTurn(1200);

check(
  "a close turn keeps a street-level zoom",
  zClose.zoom >= 16.0,
  `zoom ${zClose.zoom.toFixed(2)}`
);
check(
  "a distant turn pulls the camera back",
  zFar.zoom < zClose.zoom - 0.5,
  `close ${zClose.zoom.toFixed(2)} → far ${zFar.zoom.toFixed(2)}`
);
check(
  "the camera never zooms IN past the 16.5 base",
  zClose.zoom <= 16.55 && zMid.zoom <= 16.55 && zFar.zoom <= 16.55,
  `max ${Math.max(zClose.zoom, zMid.zoom, zFar.zoom).toFixed(2)}`
);
check(
  "the camera never zooms out into a city overview",
  zFar.zoom >= 13.5,
  `far zoom ${zFar.zoom.toFixed(2)}`
);

console.log("\n── Overlays stop crushing the map ──");
const overlay = await page.evaluate(() => {
  const wrap = document.querySelector(".mapboxgl-map")?.parentElement;
  if (!wrap) return null;
  const tops = Array.from(wrap.children)
    .filter((c) => c.className && String(c.className).includes("absolute"))
    .map((c) => {
      const r = c.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: (c.textContent || "").trim().slice(0, 30) };
    });
  return tops;
});
if (overlay && overlay.length) {
  const topRow = overlay.filter((o) => o.top < 120);
  const distinctRows = new Set(topRow.map((o) => Math.round(o.top / 10))).size;
  check(
    "the top overlay occupies ONE row, not two stacked rows",
    distinctRows <= 1,
    `top overlay rows: ${distinctRows} (${topRow.length} element(s))`
  );
  const card = overlay.find((o) => o.text.includes("%") || o.bottom > 300);
  if (card) {
    const h = card.bottom - card.top;
    check(
      "the metrics card is compact enough to leave the map visible",
      h < 140,
      `card ${h.toFixed(0)}px tall`
    );
  }
} else {
  check("the overlay row could be measured", false, "no overlay elements found");
}

console.log("\n── Console ──");
const realErrors = errors.filter((e) => !/favicon|Failed to load resource.*40[34]/.test(e));
console.log(realErrors.length ? realErrors.slice(0, 6).join("\n") : "(no errors)");

await page.screenshot({ path: "scripts/out/nav-camera.png", fullPage: false });

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
