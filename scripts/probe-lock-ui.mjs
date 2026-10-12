/**
 * Observe what the wallet-security sheet actually shows, second by second.
 * Signs in as the real customer on live, opens /wallet, taps the enrolment
 * button, and records every distinct state of the sheet until it settles.
 */
import { chromium } from "playwright";

const SITE = "https://godoor.site";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASS = "Kayemba@256";

const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=320"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const netlog = [];
page.on("request", (r) => {
  if (r.url().includes("/api/wallet")) netlog.push({ t: Date.now(), ev: "req", url: r.url().replace(SITE, ""), m: r.method() });
});
page.on("response", (r) => {
  if (r.url().includes("/api/wallet")) netlog.push({ t: Date.now(), ev: "res", url: r.url().replace(SITE, ""), s: r.status() });
});
page.on("requestfailed", (r) => {
  if (r.url().includes("/api/wallet")) netlog.push({ t: Date.now(), ev: "FAIL", url: r.url().replace(SITE, ""), err: r.failure()?.errorText });
});

async function sheetState() {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const txt = (d.textContent || "").replace(/\s+/g, " ").trim();
    const heading = d.querySelector("h2")?.textContent?.trim() || "";
    const spinner = !!d.querySelector(".animate-spin");
    const pad = !!d.querySelector('input[type="password"]');
    const alert = d.querySelector('[role="alert"]')?.textContent?.trim() || "";
    const btns = [...d.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);
    return { heading, spinner, pad, alert, btns, len: txt.length };
  });
}

console.log("== sign in ==");
await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

const signin = page.locator('header button:has-text("Sign in"), button:has-text("Sign in")').first();
await signin.click({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);

const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ timeout: 15000 });

// The modal opens in signup mode; switch to sign-in.
const toggle = dialog.locator('button:has-text("Sign in"), a:has-text("Sign in"), button:has-text("Log in")').last();
await toggle.click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);

await dialog.locator('input[type="email"]').first().fill(EMAIL);
await dialog.locator('input[type="password"]').first().fill(PASS);
await dialog.locator('button[type="submit"], button:has-text("Sign in")').last().click({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(4000);
console.log("after sign-in url:", page.url());

console.log("\n== go to /wallet ==");
await page.goto(`${SITE}/wallet`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3500);

const btn = page.locator('button:has-text("Set up wallet security"), button:has-text("Add another method")').first();
console.log("enrol button visible:", await btn.count(), "enabled:", await btn.isEnabled().catch(() => null));

console.log("\n== tap enrolment, watch the sheet ==");
await btn.click({ timeout: 15000 }).catch((e) => console.log("click failed:", e.message));

const t0 = Date.now();
const seen = new Map();
for (let i = 0; i < 40; i++) {
  const st = await sheetState();
  if (st) {
    const key = JSON.stringify({ h: st.heading, s: st.spinner, a: st.alert });
    if (!seen.has(key)) {
      seen.set(key, Date.now() - t0);
      console.log(`  t+${String(Date.now() - t0).padStart(5)}ms  heading="${st.heading}" spinner=${st.spinner} pad=${st.pad} alert="${st.alert}" btns=${JSON.stringify(st.btns)}`);
    }
    if (st.pad || st.alert) break;
  }
  await page.waitForTimeout(1000);
}

console.log("\n== /api/wallet network ==");
for (const e of netlog) console.log(`  ${e.ev.padEnd(4)} ${String(e.s ?? "").padEnd(5)} ${e.m ?? ""} ${e.url}${e.err ? " :: " + e.err : ""}`);

const final = await sheetState();
console.log("\n== final ==");
console.log(JSON.stringify(final, null, 2));

await browser.close();