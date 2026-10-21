/**
 * Probe: why is the map test hook missing on /nav-harness?
 * Prints every console message, page error and failed request.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";

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
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
const page = await ctx.newPage();

page.on("console", (m) => console.log(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 400)}`));
page.on("requestfailed", (r) =>
  console.log(`[reqfail] ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`)
);

console.log(`→ ${BASE}/nav-harness`);
await page.goto(`${BASE}/nav-harness`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(12_000);

const probe = await page.evaluate(() => {
  const mapbox = document.querySelector(".mapboxgl-map");
  const canvas = document.querySelector(".mapboxgl-canvas");
  const gl = (() => {
    try {
      const c = document.createElement("canvas");
      const ctx = c.getContext("webgl2") || c.getContext("webgl");
      if (!ctx) return "NO WEBGL CONTEXT";
      const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
      return dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "webgl ok";
    } catch (e) {
      return "ERR " + e.message;
    }
  })();
  return {
    hasHook: typeof window.__godoorMapState,
    hasMap: typeof window.__godoorMap,
    mapboxEl: !!mapbox,
    canvasEl: !!canvas,
    canvasSize: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
    webgl: gl,
    bodyText: (document.body?.innerText || "").slice(0, 300),
  };
});

console.log("\n=== PROBE ===");
console.log(JSON.stringify(probe, null, 2));

await browser.close();
