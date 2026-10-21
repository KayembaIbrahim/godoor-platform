/**
 * Focused check: does the location modal return NAMED places for a query?
 *
 * Run with:  node tools/qa/verify-places.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`  ok    ${label}${detail ? " — " + detail : ""}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const locBtn = page.locator('button[aria-label*="Delivery location"]');
ok("the delivery-location control exists", (await locBtn.count()) > 0);
await locBtn.first().click();
await page.waitForTimeout(900);

const input = page.locator('input[placeholder*="Search area"]');
ok("the location modal opened", (await input.count()) > 0);

// The results are the buttons in the scrollable list, which is the only
// element with a max-height on this modal. Take the text of the LIST, not
// of every button in the dialog.
async function suggestions(q) {
  await input.first().fill(q);
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return [];
    // The results list is the scrollable region.
    const list = dialog.querySelector('div[class*="max-h"]');
    if (!list) return [];
    return Array.from(list.querySelectorAll("button")).map((b) => b.innerText.trim());
  });
}

console.log("\n── typed places are named ──");
for (const q of ["Nansana", "Kawempe", "Buhweju", "Masaka", "Ntinda", "Gulu", "Mbarara", "Kazo"]) {
  const rows = await suggestions(q);
  const hit = rows.find((t) => t.toLowerCase().includes(q.toLowerCase()));
  ok(`"${q}" → a named row`, !!hit, hit ? hit.replace(/\n/g, " · ") : `got: ${JSON.stringify(rows).slice(0, 90)}`);
}

console.log("\n── no raw coordinates anywhere ──");
for (const q of ["Kawempe", "Buhweju"]) {
  const rows = await suggestions(q);
  ok(`"${q}" shows no coordinate string`, !rows.some((t) => /°/.test(t)), rows.join(" | ").slice(0, 80));
}

ok("no uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 160));
await browser.close();
console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
