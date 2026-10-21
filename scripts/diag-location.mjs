/**
 * Location diagnostic — answers ONE question: after the app has had its
 * chance to auto-detect, does the location end up FILLED IN?
 *
 * The bug reports were "location is not filled automatically" and "the map
 * issue is still critical". Both point at the same thing: the customer never
 * gets a position, so the map has nothing to centre on and the address field
 * stays empty.
 *
 * This watches the real network traffic from a real browser, so it measures
 * what the deployed app actually does — not what the source says it should do.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";

const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
});
// NO geolocation permission and NO geolocation override: this simulates the
// worst case (user denied GPS / WebView has no location handler), which is
// exactly when the IP fallback has to carry the app.
const ctx = await browser.newContext({
  viewport: { width: 412, height: 900 },
  permissions: [],
});
const page = await ctx.newPage();

const requests = [];
page.on("request", (r) => {
  const u = r.url();
  if (/ipwho|freeipapi|geojs|ipapi|mapbox|reverse|geocod/i.test(u)) {
    requests.push({ url: u.slice(0, 110), method: r.method() });
  }
});
const responses = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/ipwho|freeipapi|geojs|ipapi/i.test(u)) {
    responses.push({ url: u.slice(0, 110), status: r.status() });
  }
});
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 180)); });

const ROUTES = (process.env.ROUTES || "/,/explore,/app,/tracking").split(",");

for (const route of ROUTES) {
  requests.length = 0;
  responses.length = 0;
  errors.length = 0;

  console.log(`\n\n════════ ${BASE}${route} ════════`);
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(18_000);

  const state = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const lower = text.toLowerCase();
    const marker = document.querySelector(".mapboxgl-marker");
    const map = document.querySelector(".mapboxgl-map");
    return {
      hasDetectingText: lower.includes("detecting"),
      hasDetectedText: lower.includes("detected"),
      mapPresent: !!map,
      markerCount: document.querySelectorAll(".mapboxgl-marker").length,
      markerTransform: marker ? getComputedStyle(marker).transform : null,
      coordinateText: (text.match(/\d+\.\d{3,}\s*,\s*\d+\.\d{3,}/g) || []).slice(0, 3),
      locationWords: (text.match(/[^.]*\b(location|kampala|detecting|gps|address)\b[^.]*/gi) || [])
        .slice(0, 3).map((s) => s.replace(/\s+/g, " ").trim().slice(0, 90)),
    };
  });

  console.log(JSON.stringify(state, null, 2));
  console.log("  IP REQS: " + (requests.length ? requests.map((r) => r.method + " " + r.url).join(" | ") : "(none)"));
  console.log("  IP RES:  " + (responses.length ? responses.map((r) => r.status + " " + r.url).join(" | ") : "(none)"));
  console.log("  ERRORS:  " + (errors.length ? errors.slice(0, 3).join(" | ") : "(none)"));
}


await browser.close();
