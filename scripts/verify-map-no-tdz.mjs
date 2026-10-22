import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "https://godoor.site";
const OUT = process.env.OUTPUT || "/tmp/tdz-check.json";
const results = [];

async function probe(page, name, url) {
  const errs = [];
  const crashed = { value: false };
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
  page.on("crash", () => (crashed.value = true));

  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => ({ status: () => 0, ok: () => false, _err: e.message }));

  // wait briefly for any async render
  await page.waitForTimeout(1500).catch(() => {});

  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 200) : ""));
  const hasMap = await page.evaluate(() => !!document.querySelector(".mapboxgl-map, .leaflet-container, [class*='map']"));
  const hasError = bodyText.includes("Something went wrong") || bodyText.includes("Cannot access") || bodyText.includes("before initialization");

  results.push({
    name,
    url,
    status: res.status ? res.status() : 0,
    crashed: crashed.value,
    hasMap,
    hasError,
    errors: errs.slice(0, 5),
    bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 120),
  });
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-features=VizDisplayCompositor",
    "--js-flags=--max-old-space-size=384",
    "--disable-features=TranslateUI",
    "--disable-features=InterestCoordinator",
  ],
});

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

// Test the pages that use MapboxMap (the ones the TDZ crash would affect)
await probe(page, "business (uses MapboxMap)", `${BASE}/business`);
await probe(page, "checkout (uses MapboxMap)", `${BASE}/checkout`);

await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(results, null, 2));