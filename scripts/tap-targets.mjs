import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(11000);

const res = await page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll("button,a,[role=button],input,select")) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height >= 44) continue;
    const name = (b.getAttribute("aria-label") || b.innerText || b.getAttribute("placeholder") || b.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 46);
    if (!name) continue;
    out.push({
      tag: b.tagName,
      name,
      w: Math.round(r.width),
      h: Math.round(r.height),
      y: Math.round(r.top + window.scrollY),
      cls: (b.className || "").toString().slice(0, 90),
      parent: (b.parentElement?.className || "").toString().slice(0, 60),
    });
  }
  const loc = document.body.innerText.match(/(📍[^\n]{0,60})/);
  const locBtn = [...document.querySelectorAll("button")].map(b => (b.innerText||"").trim()).filter(t=>/location|detect|choose|where|area/i.test(t));
  return { small: out, locationText: loc ? loc[1] : null, locButtons: locBtn.slice(0,5) };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
