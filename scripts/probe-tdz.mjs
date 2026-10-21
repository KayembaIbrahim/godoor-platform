/**
 * Probe: which live routes crash in the browser with
 * "Cannot access 'X' before initialization" (a TDZ / circular-import error)?
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
const ROUTES = (process.env.ROUTES || "/,/signin,/explore,/app,/tracking,/categories,/nav-harness").split(",");

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

for (const route of ROUTES) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.split("\n")[0].slice(0, 140)));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      if (!/favicon|Failed to load resource|404|403/.test(t)) errs.push(t.split("\n")[0].slice(0, 140));
    }
  });
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(5000);
    const info = await page.evaluate(() => ({
      crashed: /Something went wrong/.test(document.body?.innerText || ""),
      mapbox: !!document.querySelector(".mapboxgl-map"),
      hook: typeof window.__godoorMapState,
      len: (document.body?.innerText || "").length,
    }));
    console.log(`${route.padEnd(14)} crashed=${info.crashed ? "YES" : "no "} mapbox=${info.mapbox ? "y" : "n"} hook=${info.hook} textlen=${info.len}`);
    const uniq = [...new Set(errs)];
    if (uniq.length) uniq.slice(0, 4).forEach((e) => console.log(`      ! ${e}`));
  } catch (e) {
    console.log(`${route.padEnd(14)} NAV-ERROR ${e.message.split("\n")[0].slice(0, 120)}`);
  }
  await page.close();
}

await browser.close();
