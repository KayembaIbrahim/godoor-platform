/**
 * Probe a SINGLE route per browser launch (the sandbox is memory-tight, and a
 * browser that dies mid-run tells us nothing about the next route).
 *
 * Usage: node scripts/probe-one.mjs <route> [baseUrl]
 */
import { chromium } from "playwright";

const route = process.argv[2] || "/";
const BASE = process.argv[3] || process.env.BASE_URL || "https://godoor.site";

const browser = await chromium.launch({
  args: [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--single-process",
    "--disable-features=IsolateOrigins,site-per-process",
    "--renderer-process-limit=1",
    "--js-flags=--max-old-space-size=320",
    "--enable-unsafe-swiftshader",
    "--disable-accelerated-2d-canvas",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 760 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push("PE " + e.message.split("\n")[0].slice(0, 160)));
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text();
    if (!/favicon|Failed to load resource|status of 40[34]|net::ERR/.test(t))
      errs.push("CE " + t.split("\n")[0].slice(0, 160));
  }
});

let nav = "ok";
try {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(6000);
} catch (e) {
  nav = "NAV-FAIL " + e.message.split("\n")[0].slice(0, 90);
}

let info = {};
try {
  info = await page.evaluate(() => ({
    crashed: /Something went wrong/.test(document.body?.innerText || ""),
    mapbox: !!document.querySelector(".mapboxgl-map"),
    hook: typeof window.__godoorMapState,
    textlen: (document.body?.innerText || "").length,
    snippet: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 180),
  }));
} catch (e) {
  info = { evalError: e.message.slice(0, 90) };
}

console.log(JSON.stringify({ route, base: BASE, nav, ...info, errors: [...new Set(errs)].slice(0, 5) }, null, 2));

await browser.close().catch(() => {});
