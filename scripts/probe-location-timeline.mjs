/**
 * Watch the /app location label resolve over time, rather than sampling once
 * and guessing. The hook's worst case is 10s GPS + IP fallback + a 30s watch,
 * so a single early read always shows "Finding your location…".
 */
import { chromium } from "playwright";

const EMAIL = process.argv[2];
const PASS = process.argv[3];
const TOTAL_S = Number(process.argv[4] || 55);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.route("**/*", (r) => {
  const t = r.request().resourceType();
  if (t === "image" || t === "font" || t === "media") return r.abort();
  return r.continue();
});

await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded" });
if (await page.locator('input[type="email"]').count()) {
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  const toSignIn = page.getByRole("button", { name: /sign in/i }).first();
  if (await toSignIn.count()) await toSignIn.click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button:has-text("Sign in")').last().click().catch(() => {});
}
try { await page.waitForURL(/\/app/, { timeout: 25000 }); } catch {}

// Poll the label every 2s and record only when it CHANGES.
const timeline = [];
let last = null;
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < TOTAL_S) {
  const s = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /location|detect|delivery address|current location|using your/i.test(x.innerText || ""),
    );
    return b ? b.innerText.replace(/\s+/g, " ").trim() : "(no location button)";
  });
  if (s !== last) {
    timeline.push({ s: Math.round((Date.now() - t0) / 1000), text: s });
    last = s;
  }
  await page.waitForTimeout(2000);
}

const final = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /location|detect|delivery address|current location|using your/i.test(x.innerText || ""),
  );
  const txt = b ? b.innerText.replace(/\s+/g, " ").trim() : "";
  return {
    text: txt,
    isManualPrompt: /set your delivery address/i.test(txt),
    mentionsCity: /kampala|masaka|nansana|mukono|uganda/i.test(txt),
    usingCurrent: /using your current location/i.test(txt),
  };
});

console.log(JSON.stringify({ timeline, final }, null, 2));
await browser.close();