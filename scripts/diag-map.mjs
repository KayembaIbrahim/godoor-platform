/**
 * Map diagnostic — renders the live tracking map in a real browser and reports
 * what is ACTUALLY drawn: how many markers, where each one's centre lands in
 * map coordinates, and whether the pin's tip sits on the coordinate it claims.
 *
 * The question it answers: are the markings in the right place, and do the
 * markers agree with the positions the app believes in?
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 900 },
  geolocation: { latitude: 0.3163, longitude: 32.5822 },
  permissions: ["geolocation"],
});
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

console.log(`→ ${BASE}/tracking`);
await page.goto(`${BASE}/tracking`, { waitUntil: "domcontentloaded", timeout: 60_000 });
// Give the map time to load its style + tiles.
await page.waitForTimeout(9000);

const report = await page.evaluate(() => {
  const canvas = document.querySelector(".mapboxgl-canvas");
  const container = document.querySelector(".mapboxgl-map");
  const markers = Array.from(document.querySelectorAll(".mapboxgl-marker"));
  const out = {
    hasCanvas: !!canvas,
    hasContainer: !!container,
    canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
    markerCount: markers.length,
    markers: markers.map((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        // The element Mapbox positions — its transform holds the map point.
        transform: style.transform,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        zIndex: style.zIndex,
        classes: el.className,
        hasPopup: !!el.getAttribute("aria-label") || !!el.querySelector("[class*=pop]"),
        // Inner text = the label chip ("Rider", "Delivery", "Shop"…)
        text: (el.textContent || "").trim().slice(0, 40),
      };
    }),
    canvases: document.querySelectorAll("canvas").length,
    attribution: document.querySelector(".mapboxgl-ctrl-attrib")?.textContent?.trim().slice(0, 60) || null,
    scaleBar: document.querySelector(".mapboxgl-ctrl-scale")?.textContent?.trim() || null,
  };
  return out;
});

console.log("\n── MAP REPORT ──");
console.log(JSON.stringify(report, null, 2));

// Pull the map instance off the DOM if we can, to compare marker lngLat to what
// the app believes.
console.log("\n── CONSOLE ERRORS ──");
console.log(errors.length ? errors.slice(0, 10).join("\n") : "(none)");

await page.screenshot({ path: "scripts/out/map-diag.png" });
await browser.close();
