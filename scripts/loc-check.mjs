import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(11000);

const res = await page.evaluate(() => {
  const searchInput = document.querySelector('input[type="text"],input:not([type])');
  const field = searchInput?.closest("div");

  // anything rendered in the top 400px, described
  const near = [...document.querySelectorAll("button,div,a,span,p,h1,h2,h3")]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.top < 420 && r.height > 0 && r.width > 0;
    })
    .filter((e) => !e.querySelector("button") && e.children.length <= 2)
    .map((e) => ({
      tag: e.tagName,
      txt: (e.innerText || "").trim().replace(/\s+/g, " ").slice(0, 54),
      h: Math.round(e.getBoundingClientRect().height),
      y: Math.round(e.getBoundingClientRect().top),
    }))
    .filter((e) => e.txt.length > 0);

  return {
    searchFieldParent: field ? { h: Math.round(field.getBoundingClientRect().height), cls: (field.className||"").slice(0,80) } : null,
    topText: [...new Map(near.map(n => [n.y + "|" + n.txt, n])).values()].slice(0, 30),
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
