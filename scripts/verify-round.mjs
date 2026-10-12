/**
 * Live check for this round: duplicate theme toggle, light mode, wallet card.
 * Run: node --import ./scripts/register-alias.mjs scripts/verify-round.mjs
 */
import { chromium } from "playwright";

const BASE = "https://godoor.site";
const EXE = "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASS = "Kayemba Ibrahim"; // the password that actually authenticates

const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 60000 });

// Sign in through the app's own modal.
await page.getByRole("button", { name: /sign in/i }).first().click().catch(() => {});
await page.waitForTimeout(700);
const modeSwitch = page.getByRole("button", { name: /switch to sign in|sign in/i }).first();
await modeSwitch.click().catch(() => {});
await page.waitForTimeout(500);
await page.locator('input[type="email"]').first().fill(EMAIL).catch(() => {});
await page.locator('input[type="password"]').first().fill(PASS).catch(() => {});
await page.locator('button[type="button"]').filter({ hasText: /^sign in$/i }).last().click().catch(() => {});
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const themeButtons = q("button").filter(
    (b) => /switch to .* mode|toggle theme/i.test(b.getAttribute("aria-label") || ""),
  );
  const logos = q('img[src*="godoor-logo"]');
  const cs = (el) => (el ? getComputedStyle(el) : null);

  const header = q("header")[0];
  const walletText = (() => {
    const el = q("*").find((e) => /GoDoor Pay/i.test(e.textContent || "") && e.children.length < 12);
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : null;
  })();

  return {
    themeToggles: themeButtons.length,
    logos: logos.length,
    isDark: document.documentElement.classList.contains("dark"),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    headerBg: cs(header)?.backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    headerColor: cs(header)?.color,
    headingFont: (() => {
      const h = q("h1,h2")[0];
      return h ? getComputedStyle(h).fontFamily : null;
    })(),
    bodyFont: getComputedStyle(document.body).fontFamily,
    walletText,
    hasWithdraw: q("button").some((b) => /withdraw/i.test(b.textContent || "")),
    escrowShown: /in escrow/i.test(document.body.innerText || ""),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

console.log(JSON.stringify({ ...out, pageErrors: errs }, null, 2));
await browser.close();
