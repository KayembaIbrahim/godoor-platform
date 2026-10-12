/**
 * Live check of the Send Money UI on the customer home.
 *
 * Signs in as the real customer, confirms the wallet card exposes a Send
 * action next to Withdraw, opens the sheet and verifies the real fields and
 * live-quoted fee render. Reads only — no money moves.
 */
import { chromium } from "playwright";

const SITE = "https://godoor.site";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASSWORD = "Kayemba@256";

const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--js-flags=--max-old-space-size=256",
    "--disable-extensions",
    "--disable-background-networking",
  ],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
/* Images, fonts and media are the bulk of the memory here and none of them
   are what this check is looking at. */
await page.route("**/*", (route) => {
  const t = route.request().resourceType();
  if (t === "image" || t === "font" || t === "media") return route.abort();
  return route.continue();
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));

try {
  await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  // Sign-in lives in a modal, not a route.
  const signIn = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await signIn.count()) {
    await signIn.click();
    await page.waitForTimeout(900);
    const dlg = page.getByRole("dialog");
    // The modal opens in signup mode by default; switch to sign in.
    const existing = dlg.locator('input[type="email"]').first();
    if (await existing.count()) {
      await existing.fill(EMAIL);
      await dlg.locator('input[type="password"]').first().fill(PASSWORD);
      await page.waitForTimeout(300);
      const submit = dlg.locator('button[type="button"]').filter({ hasText: /sign in/i }).last();
      await submit.click();
    } else {
      const toggle = dlg.getByRole("button", { name: /sign in|log in/i }).first();
      await toggle.click();
      await page.waitForTimeout(600);
      await dlg.locator('input[type="email"]').first().fill(EMAIL);
      await dlg.locator('input[type="password"]').first().fill(PASSWORD);
      await dlg.locator('button[type="button"]').filter({ hasText: /sign in/i }).last().click();
    }
    await page.waitForTimeout(5000);
  }

  await page.goto(`${SITE}/app`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  const body = await page.textContent("body");
  console.log("on /app:", page.url().includes("/app"));
  console.log("wallet card present:", /GoDoor Pay/i.test(body || ""));

  const send = page.getByRole("button", { name: /^send$/i }).first();
  const withdraw = page.getByRole("button", { name: /^withdraw$/i }).first();
  console.log("Send button on wallet card:", await send.count() > 0);
  console.log("Withdraw button present:", await withdraw.count() > 0);

  if (await send.count()) {
    await send.click();
    await page.waitForTimeout(3500);

    const dlg = page.getByRole("dialog");
    const open = await dlg.count();
    console.log("sheet opened:", open > 0);
    if (open) {
      const text = (await dlg.first().textContent()) || "";
      console.log("  heading 'Send money':", /Send money/i.test(text));
      console.log("  recipient email field:", await dlg.locator('input[type="email"]').count());
      console.log("  amount field:", await dlg.locator('input[inputmode="numeric"]').count());
      console.log("  note field:", await dlg.locator('input[placeholder*="What is this"]').count());
      console.log("  shows Available balance:", /Available/i.test(text));

      const amtField = dlg.locator('input[inputmode="numeric"]').first();
      await amtField.fill("50000");
      await dlg.locator('input[type="email"]').first().fill("someone@example.com");
      await page.waitForTimeout(700);
      const after = (await dlg.first().textContent()) || "";
      console.log("  live quote shows 'They receive':", /They receive/i.test(after));
      const quoted = after.match(/They receive[^U]*UGX\s*([\d,]+)/i);
      console.log("  quoted amount:", quoted ? quoted[1] : "(not parsed)");

      const submit = dlg.locator("button").filter({ hasText: /^Send/ }).last();
      console.log("  submit enabled with valid input:", await submit.isEnabled().catch(() => false));
    }
  }

  console.log("page errors:", errors.length ? errors : "none");
} catch (e) {
  console.log("ERROR:", e.message);
} finally {
  await browser.close();
}