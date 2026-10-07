import { chromium } from "playwright";

const EXEC = "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errs = [];
const failures = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
page.on("response", (r) => { if (r.status() >= 500) failures.push(`${r.status()} ${r.url().slice(0, 90)}`); });

const t0 = Date.now();
await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });

// wait for the app shell to actually populate (not just domcontentloaded)
await page.waitForFunction(
  () => document.body.innerText.includes("GoRide") || document.body.innerText.includes("GODOOR"),
  { timeout: 45000 },
).catch(() => {});
await page.waitForTimeout(6000);
const settleMs = Date.now() - t0;

const out = await page.evaluate(() => {
  const txt = document.body.innerText;
  const norm = txt.replace(/\s+/g, " ");
  const locMatch = txt.match(/([A-Za-z][A-Za-z .,'-]{2,40}Hill[A-Za-z .,'-]{0,24})/);

  // stuck loaders: a spinner word still visible well after load
  const stuck = [];
  for (const w of ["Detecting your area", "Finding shops near you", "LOADING BUSINESSES", "Detecting location"]) {
    if (norm.includes(w)) stuck.push(w);
  }

  const btn = [...document.querySelectorAll("button,a,[role=button]")];
  const unnamed = btn.filter((b) => {
    const n = (b.getAttribute("aria-label") || b.innerText || b.getAttribute("title") || "").trim();
    const box = b.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false; // hidden/mobile-hidden
    return !n;
  }).length;

  const small = btn.filter((b) => {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return r.height < 44 && (b.getAttribute("aria-label") || b.innerText || "").trim().length > 0;
  }).length;

  const navs = [...document.querySelectorAll("nav")].map((n) => {
    const r = n.getBoundingClientRect();
    return { cls: (n.className || "").slice(0, 40), pos: getComputedStyle(n).position, h: Math.round(r.height), links: n.querySelectorAll("a").length };
  });

  const h1 = document.querySelectorAll("h1").length;

  // wallet card presence + state
  const hasPay = /GODOOR\s*PAY/i.test(norm);
  const signedOutPrompt = /sign in to see your balance/i.test(norm);

  return {
    h1,
    stuck,
    unnamed,
    small,
    navs,
    hasPay,
    signedOutPrompt,
    location: locMatch ? locMatch[1].trim() : null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    textLen: txt.length,
    services: ["GoRide","GoFood","GoMart","GoExpress","GoPharma","GoPay","Services"].filter((s) => norm.includes(s)),
    truncated: (norm.match(/[A-Za-z& ]{4}\.\.\./g) || []),
    errorBanner: /something went wrong|unexpected error|application error/i.test(norm),
  };
});

console.log(JSON.stringify({ settleMs, ...out, pageErrors: errs, server5xx: failures }, null, 2));

// --- the two bugs the user explicitly named ---
const allProducts = page.getByRole("button", { name: /all products/i }).first();
if (await allProducts.count()) {
  await allProducts.click({ timeout: 10000 }).catch((e) => console.log("click failed:", String(e).slice(0, 80)));
  await page.waitForTimeout(1500);
  const box = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
  if (await box.count()) {
    await box.fill("sofa").catch(() => {});
    await page.waitForTimeout(2500);
  }
  const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
  console.log(JSON.stringify({
    allProductsSheet: await box.count() > 0,
    crashAfterSearch: /Application error|something went wrong/i.test(t),
    sawResult: /sofa|UGX/i.test(t),
    postSearchErrors: errs.length,
  }));
} else {
  console.log(JSON.stringify({ allProductsButtonFound: false }));
}

await browser.close();
