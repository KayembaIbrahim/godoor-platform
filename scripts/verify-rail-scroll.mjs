/**
 * Verify the customer-home category rail actually scrolls horizontally.
 *
 * THE BUG THIS CHECKS
 * -------------------
 * A customer reported: "the section with catalogue icons doesn't scroll —
 * it's only businesses that scroll". The rail was derived from live merchants
 * only, so production's two shops produced two chips that fit on screen and
 * there was literally nothing to scroll.
 *
 * Source fix: seed the rail with the four verticals plus CORE_RAIL_CATEGORIES
 * so it is navigation rather than a stock report.
 *
 * What this proves: on a real 390px phone, the rail's scrollWidth exceeds its
 * clientWidth (so it IS scrollable), that scrolling it moves the content, and
 * that the business card rail below is independently scrollable — i.e. both
 * rails behave the same way, which was the user's actual complaint.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("/tmp/chk/.env.prod", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const EMAIL = process.env.RIDER_EMAIL ?? "ibrahimkapoor11@gmail.com";
const PASSWORD = process.env.ACCOUNT_PASSWORD ?? process.env.RIDER_PASSWORD;

const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=380"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
// Images, fonts and media are irrelevant to a layout/scroll measurement and are
// the bulk of the memory on this box (~880 MB available). Blocking them is what
// lets the browser survive to the assertion.
await ctx.route("**/*", (route) => {
  const t = route.request().resourceType();
  if (t === "image" || t === "font" || t === "media") return route.abort();
  return route.continue();
});
const page = await ctx.newPage();

const fails = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!cond) fails.push(label);
};

// --- sign in -------------------------------------------------------------
await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);

const signInBtn = page.locator('button:has-text("Sign in")').first();
if (await signInBtn.count()) {
  await signInBtn.click();
  await page.waitForTimeout(800);
  const dialog = page.locator('[role="dialog"]').first();
  if (await dialog.count()) {
    const switcher = dialog.locator('button:has-text("Sign in")').first();
    if (await switcher.count()) await switcher.click().catch(() => {});
    await page.waitForTimeout(400);
    await dialog.locator('input[type="email"]').first().fill(EMAIL);
    await dialog.locator('input[type="password"]').first().fill(PASSWORD);
    await dialog.locator('button[type="submit"]').first().click().catch(() => {});
    await page.waitForTimeout(6000);
  }
}

const signedIn = !(await page.locator("body").innerText()).includes("Sign in to see your balance");
console.log(`\nsigned in: ${signedIn}\n`);
if (!signedIn) console.log("!! still signed out - measurements below are the signed-out view\n");

// --- wait for location --------------------------------------------------
// `effectiveLoc` is null while the GPS read is in flight (~10s on a cold
// start), and the "Popular near you" business rail is gated on it. Measuring
// before that settles reports a missing rail that is really just not rendered
// yet — which is exactly the false negative to avoid here.
await page.waitForTimeout(14000);
const locResolved = await page.evaluate(() => !!document.body.innerText.match(/Popular near you/i));
console.log(`location settled: ${locResolved} ("Popular near you" present)\n`);

// --- measure both rails --------------------------------------------------
const rails = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const ox = cs.overflowX;
    if (ox !== "auto" && ox !== "scroll") continue;
    if (el.scrollWidth <= el.clientWidth) continue; // nothing to scroll
    out.push({
      cls: (el.className || "").toString().slice(0, 90),
      isCategoryRail: el.classList.contains("rail-fade"),
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      overflowBy: el.scrollWidth - el.clientWidth,
      chips: el.children.length,
      text: el.innerText.replace(/\s+/g, " ").slice(0, 70),
    });
  }
  return out;
});

// The rail MUST be scrollable, and it must be the catalogue rail (rail-fade).
const catRail = rails.find((r) => r.isCategoryRail);
ok(
  "category rail is scrollable (scrollWidth > clientWidth)",
  !!catRail,
  catRail ? `overflow=${catRail.overflowBy}px  chips=${catRail.chips}` : "no scrollable .rail-fade element found",
);

if (catRail) {
  ok("category rail has enough chips to be navigation", catRail.chips >= 10, `chips=${catRail.chips}`);
  console.log(`     rail text: "${catRail.text}"`);
}

// The user's contrast complaint: businesses scrolled, catalogue did not.
const bizRail = rails.find((r) => !r.isCategoryRail);
ok(
  "both rails scroll (catalogue + businesses behave the same)",
  !!catRail && !!bizRail,
  bizRail ? `business rail overflow=${bizRail.overflowBy}px chips=${bizRail.chips}` : "no scrollable business rail found",
);

// --- prove it actually moves on scroll ----------------------------------
const moved = await page.evaluate(() => {
  const el = document.querySelector(".rail-fade");
  if (!el) return null;
  const before = el.scrollLeft;
  el.scrollLeft = 400;
  const after = el.scrollLeft;
  el.scrollLeft = before;
  return { before, after };
});
ok(
  "rail scrollLeft actually changes when scrolled",
  !!moved && moved.after > moved.before,
  moved ? `scrollLeft ${moved.before} -> ${moved.after}` : "no rail",
);

const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("page has no horizontal overflow", overflowX <= 0, `overflowX=${overflowX}`);

await browser.close();

console.log(`\n${fails.length === 0 ? "ALL PASS" : `${fails.length} FAIL`}: ${fails.join(" | ") || "none"}`);
process.exit(fails.length === 0 ? 0 : 1);