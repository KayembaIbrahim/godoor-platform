/**
 * Live probe for the four /app fixes. Measures the capsule element itself
 * (.nav-float), not the transparent <nav> wrapper, which was the mistake that
 * made the previous run report a full-bleed bar.
 */
import { chromium } from "playwright";

const EMAIL = process.argv[2];
const PASS = process.argv[3];

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

// Cut memory: images and fonts are irrelevant to layout measurement.
await page.route("**/*", (r) => {
  const t = r.request().resourceType();
  if (t === "image" || t === "font" || t === "media") return r.abort();
  return r.continue();
});

const out = {};

// ---- sign in -------------------------------------------------------------
await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.setItem("godoor-theme-v5-white", JSON.stringify({ state: { theme: "light" }, version: 0 })));
await page.reload({ waitUntil: "domcontentloaded" });

const needSignIn = await page.locator('input[type="email"]').count();
if (needSignIn) {
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  // The modal opens in signup mode; switch to sign-in.
  const toSignIn = page.getByRole("button", { name: /sign in/i }).first();
  if (await toSignIn.count()) await toSignIn.click().catch(() => {});
  await page.waitForTimeout(400);
  const pw = page.locator('input[type="password"]').first();
  if (await pw.count()) {
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await pw.fill(PASS);
    const go = page.locator('button:has-text("Sign in")').last();
    await go.click().catch(() => {});
  }
}
try {
  await page.waitForURL(/\/app/, { timeout: 25000 });
} catch {}
await page.waitForTimeout(9000); // let the GPS/IP location read settle

// ---- 1. the capsule, measured directly ----------------------------------
out.capsule = await page.evaluate(() => {
  const el = document.querySelector(".nav-float");
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    found: true,
    vw: window.innerWidth,
    left: Math.round(r.left),
    right: Math.round(r.right),
    width: Math.round(r.width),
    gapLeft: Math.round(r.left),
    gapRight: Math.round(window.innerWidth - r.right),
    radius: cs.borderRadius,
    backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
    h: Math.round(r.height),
  };
});

// ---- 2. sticky header scoping: the catalogue must scroll away ------------
out.scroll = await page.evaluate(async () => {
  const head = document.querySelector("header");
  const rail = document.querySelector(".rail-fade");
  const before = head ? Math.round(head.getBoundingClientRect().bottom) : null;
  const railBefore = rail ? Math.round(rail.getBoundingClientRect().top) : null;
  window.scrollTo(0, 1400);
  await new Promise((r) => setTimeout(r, 900));
  const after = head ? Math.round(head.getBoundingClientRect().top) : null;
  const railAfter = rail ? Math.round(rail.getBoundingClientRect().top) : null;
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  return {
    headerBottomBefore: before,
    headerTopAfterScroll: after,
    railTopBefore: railBefore,
    railTopAfterScroll: railAfter,
    headerStuckTop: after !== null ? Math.abs(after - 0) < 2 : null,
    railScrolledAway: railBefore !== null && railAfter !== null ? railBefore - railAfter : null,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});

// ---- 3. location: must show a detected place, not a manual prompt -------
out.location = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const loc = btns.find((b) => /location|detect|delivery address|setting your/i.test(b.innerText || ""));
  return {
    text: loc ? loc.innerText.replace(/\s+/g, " ").trim().slice(0, 120) : null,
    isManualPrompt: /set your delivery address/i.test(loc?.innerText || ""),
    mentionsCity: /kampala|masaka|nansana|mukono|uganda/i.test(loc?.innerText || ""),
  };
});

// ---- 4. the landing-only sections that must now live on /app -------------
out.sections = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    booking: /book a table|reserve your spot/i.test(t),
    favourites: /your favourites/i.test(t),
    deliveryPref: /delivery preference/i.test(t),
    h1: document.querySelectorAll("h1").length,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();