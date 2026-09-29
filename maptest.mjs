import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--no-sandbox","--disable-dev-shm-usage"] });
const ctx = await b.newContext({
  viewport: { width: 1280, height: 900 },
  geolocation: { latitude: 0.3163, longitude: 32.5822 },
  permissions: ["geolocation"],
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: "+String(e).slice(0,160)));
p.on("console", (m) => { if (m.type()==="error") errs.push("console: "+m.text().slice(0,140)); });

async function probe(url, wait) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForTimeout(wait);
  return {
    url,
    maps: await p.locator(".mapboxgl-map").count(),
    canvases: await p.locator("canvas.mapboxgl-canvas").count(),
    noKey: await p.getByText("no API key", { exact: false }).count(),
    unavail: await p.getByText("Map unavailable", { exact: false }).count(),
    mapboxLoaded: await p.evaluate(() => typeof window.mapboxgl !== "undefined"),
  };
}

const out = [];
out.push(await probe("https://godoor.site/ride", 10000));
console.log(JSON.stringify(out, null, 2));
console.log("ERRORS:", JSON.stringify(errs.slice(0,8), null, 2));
await b.close();
