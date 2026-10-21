/**
 * Live verification of the three changes in this release:
 *   1. the profile / account control is on the LEFT of the header cluster and
 *      the avatar disc has a 3D treatment;
 *   2. the catalog discs have depth (gradient, layered shadow, raised glyph);
 *   3. typing a Ugandan place returns NAMED suggestions.
 *
 * Run with:  node tools/qa/verify-ui.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
const EMAIL = process.env.QA_EMAIL || "verifymap+test@example.com";
const PASSWORD = process.env.QA_PASSWORD || "TestPass123";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`  ok    ${label}${detail ? " — " + detail : ""}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });

/** Sign in through the real auth modal and land on /app. */
async function signIn(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  // Open the auth modal.
  await page.locator('button:has-text("Sign in")').first().click();
  await page.waitForTimeout(600);
  const email = page.locator('input[type="email"]');
  const pass = page.locator('input[type="password"]');
  await email.first().fill(EMAIL);
  await pass.first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign in")').last().click();
  await page.waitForTimeout(3500);
  return page.url();
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// ── 1. the account control ────────────────────────────────────────────────
console.log("\n── header / account control ──");
await signIn(page);
console.log(`  ..   signed in, at ${page.url()}`);

const accountBtn = page.locator('button[aria-label="Account menu"]');
if ((await accountBtn.count()) === 0) {
  // Signed out: HeaderAuth renders the "Sign in" button in the same slot.
  const signInBtn = page.locator('header button:has-text("Sign in")').first();
  const has = (await signInBtn.count()) > 0;
  ok("an account control is present in the header", has);
  if (has) {
    const box = await signInBtn.boundingBox();
    const row = await page.locator("header").first().boundingBox();
    ok(
      "the account control is on the LEFT half of the header row",
      !!box && !!row && box.x < row.x + row.width / 2,
      box ? `x=${Math.round(box.x)} in a ${Math.round(row.width)}px row` : "",
    );
  }
} else {
  const box = await accountBtn.first().boundingBox();
  const row = await page.locator("header").first().boundingBox();
  ok(
    "the avatar is on the LEFT half of the header row",
    !!box && !!row && box.x < row.x + row.width / 2,
    box ? `x=${Math.round(box.x)} in a ${Math.round(row.width)}px row` : "",
  );

  const style = await accountBtn.first().evaluate((el) => {
    const disc = el.querySelector("div");
    if (!disc) return null;
    const cs = getComputedStyle(disc);
    return {
      gradient: cs.backgroundImage,
      shadow: cs.boxShadow,
      hasRim: !!disc.querySelector("span[aria-hidden]"),
      glyphShadow: disc.querySelector("span:not([aria-hidden])")
        ? getComputedStyle(disc.querySelector("span:not([aria-hidden])")).textShadow
        : null,
    };
  });
  ok("the avatar disc is a gradient (3D plate)", !!style?.gradient?.includes("gradient"), style?.gradient?.slice(0, 46));
  ok("the avatar disc carries a layered shadow", !!style?.shadow && style.shadow !== "none", style?.shadow?.slice(0, 66));
  ok("the avatar has a lit rim highlight", !!style?.hasRim);
}

// ── 2. the catalog discs are 3D ───────────────────────────────────────────
console.log("\n── catalog discs ──");
await page.goto(`${BASE}/categories`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const discs = page.locator(".hybrid-disc");
const n = await discs.count();
ok("the catalogue renders category discs", n > 0, `${n} discs`);
if (n > 0) {
  const s = await discs.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const svg = el.querySelector("svg");
    // Count the shadow layers the browser actually applied.
    const shadow = cs.boxShadow;
    const layers = shadow === "none" ? 0 : shadow.split(/,(?![^(]*\))/).length;
    return {
      gradient: cs.backgroundImage,
      shadow,
      layers,
      glyphFilter: svg ? getComputedStyle(svg).filter : null,
    };
  });
  ok("the disc has a gradient top face", s.gradient.includes("gradient"), s.gradient.slice(0, 46));
  ok("the disc has 3+ shadow layers (contact + ambient + inset)", s.layers >= 3, `${s.layers} layers`);
  ok("the glyph is raised off the plate", !!s.glyphFilter && s.glyphFilter !== "none", s.glyphFilter);
}

// ── 3. typing a place returns NAMED suggestions ───────────────────────────
console.log("\n── place search names places ──");
await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const locBtn = page.locator('button[aria-label*="Delivery location"]');
ok("the delivery-location control exists", (await locBtn.count()) > 0);
if (await locBtn.count()) {
  await locBtn.first().click();
  await page.waitForTimeout(800);
  const input = page.locator('input[placeholder*="Search area"]');
  ok("the location modal opened", (await input.count()) > 0);
  if (await input.count()) {
    for (const q of ["Nansana", "Kawempe", "Buhweju", "Masaka", "Ntinda"]) {
      await input.first().fill(q);
      await page.waitForTimeout(500);
      // The results live in the modal's own list, not the page behind it.
      const results = await page
        .locator('div[role="dialog"] button, div[class*="max-h"] button')
        .allInnerTexts();
      const first = results.find((t) => t.trim().length > 0) || "(none)";
      const named = results.some((t) => t.toLowerCase().includes(q.toLowerCase()));
      ok(`"${q}" returns a named suggestion`, named, first.replace(/\n/g, " ").slice(0, 50));
    }
  }
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

await browser.close();
console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
