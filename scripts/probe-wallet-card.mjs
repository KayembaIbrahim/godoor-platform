/**
 * Count how many balance figures the wallet page shows, and confirm the PIN pad
 * actually sets a PIN end to end. Two questions, one signed-in session.
 */
import { chromium } from "playwright";

const SITE = "https://godoor.site";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASS = "Kayemba@256";
const PIN = "2468";

const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=320"],
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator('button:has-text("Sign in")').first().click({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
const d = page.locator('[role="dialog"]');
await d.waitFor({ timeout: 15000 });
await d.locator('button:has-text("Sign in"), a:has-text("Sign in"), button:has-text("Log in")').last().click().catch(() => {});
await page.waitForTimeout(400);
await d.locator('input[type="email"]').first().fill(EMAIL);
await d.locator('input[type="password"]').first().fill(PASS);
await d.locator('button[type="submit"], button:has-text("Sign in")').last().click().catch(() => {});
await page.waitForTimeout(4000);

console.log("== /wallet: how many balance figures? ==");
await page.goto(`${SITE}/wallet`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

const cards = await page.evaluate(() => {
  const txt = document.body.innerText;
  // Any UGX figure with a thousands separator is a rendered balance.
  const ugx = [...new Set(txt.match(/UGX\s?[\d,]{3,}/g) || [])];
  const labelled = [];
  for (const el of document.querySelectorAll("p,span,dd,h2,h3")) {
    const t = (el.textContent || "").trim();
    if (/^(available balance|balance)$/i.test(t)) {
      // Grab the nearest sibling/section text that carries a number.
      const box = el.closest("div")?.parentElement;
      labelled.push({ label: t, context: (box?.innerText || "").replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return { ugxFigures: ugx, labelled, hasGoDoorPay: /GoDoor Pay/i.test(txt) };
});

console.log("  'GoDoor Pay' card present:", cards.hasGoDoorPay);
console.log("  distinct UGX figures on page:", cards.ugxFigures);
console.log("  'balance' labels found:", cards.labelled.length);
for (const l of cards.labelled) console.log(`     "${l.label}" -> ${l.context}`);

const duplicates = cards.labelled.filter((l) => /available balance/i.test(l.label));
console.log(`\n  VERDICT: ${duplicates.length <= 1 ? "single balance card" : `DUPLICATE x${duplicates.length}`}`);

console.log("\n== set a real PIN end to end ==");
const posts = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/wallet/security") && r.request().method() === "POST") {
    let body = "";
    try { body = JSON.stringify(await r.json()).slice(0, 200); } catch { body = "<unparsed>"; }
    posts.push({ status: r.status(), body });
  }
});

await page.locator('button:has-text("Set up wallet security"), button:has-text("Add another method")').first().click();
await page.waitForTimeout(2500);
const sheet = page.locator('[role="dialog"]');
const padReady = await sheet.locator('input[type="password"]').count();
console.log("  PIN pad rendered:", padReady > 0);

const sheetText = async () => (await sheet.innerText().catch(() => "(closed)")).replace(/\s+/g, " ").slice(0, 200);

if (padReady > 0) {
  let heading = await sheet.locator("h2").innerText().catch(() => "?");
  console.log("  stage 1 heading:", heading);
  // A fresh account starts at "Create". Once a PIN exists the flow becomes
  // current -> create -> confirm, so drive it by heading rather than by a fixed
  // number of entries.
  for (let i = 0; i < 4 && (await sheet.count()); i++) {
    heading = await sheet.locator("h2").innerText().catch(() => "?");
    if (/Confirm your new PIN/i.test(heading)) {
      console.log("  at confirm stage — submitting");
      await sheet.locator('input[type="password"]').fill(PIN).catch(() => {});
      await page.waitForTimeout(4000);
      break;
    }
    console.log(`  after entry ${i + 1}:`, (await sheetText()).slice(0, 90));
    await sheet.locator('input[type="password"]').fill(PIN).catch(() => {});
    await page.waitForTimeout(1800);
  }
  console.log("  after final entry:", await sheetText());
}

console.log("\n  POST /api/wallet/security:");
for (const p of posts) console.log(`    ${p.status}  ${p.body}`);

const after = await page.evaluate(() => document.body.innerText);
console.log("\n  page shows PIN set:", /PIN set/i.test(after));
console.log("  still unprotected:", /not protected yet/i.test(after));

await browser.close();