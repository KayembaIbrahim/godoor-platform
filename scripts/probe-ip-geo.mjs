/**
 * Probe the IP-geolocation providers from a REAL browser context, because
 * CORS is only enforced by the browser — a curl that works can still fail in
 * the app. This is the difference between "the provider is up" and "the
 * provider is reachable from a page on godoor.site".
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const page = await browser.newPage();
await page.goto("https://godoor.site/", { waitUntil: "domcontentloaded" });

const providers = [
  ["freeipapi (current #1)", "https://freeipapi.com/api/json"],
  ["ipwho.is (current #2)", "https://ipwho.is/"],
  ["ipapi.co (blocked by CF)", "https://ipapi.co/json/"],
  ["ipapi.com", "https://ipapi.com/ip_api.php?ip=8.8.8.8"],
  ["get.geojs.io", "https://get.geojs.io/v1/ip/geo.json"],
  ["ipapi.co no-www", "https://ipapi.co/json"],
];

for (const [name, url] of providers) {
  const res = await page.evaluate(async (u) => {
    try {
      const t = setTimeout(() => {}, 0);
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      clearTimeout(t);
      const txt = (await r.text()).slice(0, 160);
      return { ok: r.ok, status: r.status, body: txt };
    } catch (e) {
      return { ok: false, status: 0, body: String(e && e.message ? e.message : e) };
    }
  }, url);
  console.log(`\n${name}\n  ${res.ok ? "OK " : "FAIL"} status=${res.status}  ${res.body.replace(/\s+/g, " ").slice(0, 150)}`);
}

await browser.close();
