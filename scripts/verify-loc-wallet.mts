import { chromium } from "playwright";

const EXEC = process.env.CHROME_BIN || "";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASS = "Kayemba@256";

const out: string[] = [];
const log = (s: string) => { out.push(s); console.log(s); };

const browser = await chromium.launch({
  executablePath: EXEC || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));

await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);

// ---- sign in ----
async function signIn() {
  const btn = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(900); }
  const email = page.locator("input[type=email]").first();
  if (!(await email.count()) || !(await email.isVisible())) {
    const link = page.getByRole("button", { name: /sign in|log in/i }).first();
    if (await link.count()) { await link.click(); await page.waitForTimeout(700); }
  }
  const e2 = page.locator("input[type=email]").first();
  if (!(await e2.count()) || !(await e2.isVisible())) { log("SIGNIN: no visible email field"); return false; }
  await e2.fill(EMAIL);
  await e2.press("Enter").catch(() => {});
  const pw = page.locator('input[type=password]').first();
  await pw.waitFor({ state: "visible", timeout: 10000 });
  await pw.fill(PASS);
  const submit = page.getByRole("button", { name: /^sign in$/i }).last();
  await submit.click().catch(() => { });
  await page.waitForTimeout(5000);
  return true;
}

const ok = await signIn();
log(`signedIn: ${ok} url=${page.url()}`);
await page.waitForTimeout(6000);

// ---- LOCATION BUTTON ----
const locInfo = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
  const b = btns.find((x) => (x.getAttribute("aria-label") || "").toLowerCase().includes("delivery location"))
    || btns.find((x) => /delivery location|set your delivery|set delivery/i.test(x.innerText || ""));
  if (!b) return { found: false };
  const r = b.getBoundingClientRect();
  const spans = Array.from(b.querySelectorAll("span")).map((s) => (s.textContent || "").trim()).filter(Boolean);
  return {
    found: true,
    text: (b.innerText || "").replace(/\s+/g, " ").trim(),
    ariaLabel: b.getAttribute("aria-label"),
    subLines: spans,
    w: Math.round(r.width), h: Math.round(r.height),
    visibleTextPainted: (b.innerText || "").trim().length > 0,
  };
});
log(`LOCATION: ${JSON.stringify(locInfo)}`);

// ---- WALLET CARD ----
const wallet = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("div")) as HTMLElement[];
  const card = all.find((d) => /GoDoor Pay/i.test(d.innerText || "") && d.innerText!.length < 700);
  if (!card) return { found: false };
  const txt = (card.innerText || "").replace(/\s+/g, " ").trim();
  const eye = card.querySelector('button[aria-label*="alance"]') as HTMLButtonElement | null;
  const numRe = /UGX\s*[\d,]+/g;
  return {
    found: true,
    text: txt.slice(0, 320),
    figures: txt.match(numRe) || [],
    eyeLabel: eye?.getAttribute("aria-label") || null,
    eyeSize: eye ? (() => { const r = eye.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() : null,
    hasWithdraw: /withdraw/i.test(txt),
    hasEscrow: /escrow/i.test(txt),
    hiddenBefore: null,
  };
});
log(`WALLET: ${JSON.stringify(wallet)}`);

// toggle hide
if (wallet.found && wallet.eyeLabel) {
  const eye = page.locator('button[aria-label*="alance"]').first();
  await eye.click();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("div")) as HTMLElement[];
    const card = all.find((d) => /GoDoor Pay/i.test(d.innerText || "") && d.innerText!.length < 700);
    const txt = (card?.innerText || "").replace(/\s+/g, " ").trim();
    const eye = card?.querySelector('button[aria-label*="alance"]') as HTMLButtonElement | null;
    return { text: txt.slice(0, 200), eyeLabel: eye?.getAttribute("aria-label"), bullets: /•/.test(txt) };
  });
  log(`AFTER_HIDE: ${JSON.stringify(after)}`);
  // restore
  await page.locator('button[aria-label*="alance"]').first().click();
  await page.waitForTimeout(800);
  const restored = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("div")) as HTMLElement[];
    const card = all.find((d) => /GoDoor Pay/i.test(d.innerText || "") && d.innerText!.length < 700);
    return (card?.innerText || "").match(/UGX\s*[\d,]+/g) || [];
  });
  log(`AFTER_RESTORE: ${JSON.stringify(restored)}`);
}

// ---- overflow / stuck ----
const misc = await page.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  logos: Array.from(document.querySelectorAll('img[src*="logo"]')).filter((i) => {
    const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }).length,
  stuck: Array.from(document.querySelectorAll("*"))
    .filter((e) => /Detecting your area|Loading businesses|Finding your location/i.test(e.textContent || ""))
    .filter((e) => (e as HTMLElement).children.length === 0).map((e) => (e.textContent || "").trim()).slice(0, 5),
}));
log(`MISC: ${JSON.stringify(misc)}`);
log(`ERRORS: ${JSON.stringify(errors.slice(0, 5))}`);

await browser.close();