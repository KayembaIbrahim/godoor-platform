import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(11000);

// Hit-test: for each small control, probe the 44px box around its centre and
// see whether the point actually resolves to that control (or a descendant).
const res = await page.evaluate(() => {
  const nameOf = (el) => {
    const hit = el.closest("button,a,[role=button]");
    if (!hit) return null;
    return (hit.getAttribute("aria-label") || hit.innerText || "").trim().replace(/\s+/g, " ").slice(0, 34);
  };

  const out = [];
  for (const el of document.querySelectorAll("button,a,[role=button],input")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ");
    if (!label) continue;
    if (r.height >= 44) continue;
    if (r.top < 0 || r.top > 600) continue; // visible viewport only

    const w = Math.max(r.width, 44), h = Math.max(r.height, 44);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const x0 = Math.max(0, cx - w / 2), x1 = Math.min(window.innerWidth, cx + w / 2);
    const y0 = Math.max(0, cy - h / 2), y1 = Math.min(window.innerHeight, cy + h / 2);

    let ok = 0, total = 0;
    for (let x = x0 + 1; x < x1; x += 3) {
      for (let y = y0 + 1; y < y1; y += 3) {
        total++;
        const t = document.elementFromPoint(x, y);
        if (t && (t === el || el.contains(t) || t.closest?.("button,a,[role=button]") === el)) ok++;
      }
    }
    out.push({ label: label.slice(0, 30), box: `${Math.round(r.width)}x${Math.round(r.height)}`, hitPct: total ? Math.round((ok / total) * 100) : 0 });
  }
  return out;
});

console.log(JSON.stringify(res, null, 1));

// search field: is the whole field tappable even though the input is 20px?
const field = await page.evaluate(() => {
  const i = [...document.querySelectorAll("input")].find((x) => /search/i.test(x.placeholder || ""));
  if (!i) return null;
  const box = i.closest("div");
  const r = box.getBoundingClientRect();
  return { inputH: Math.round(i.getBoundingClientRect().height), containerH: Math.round(r.height), containerCls: (box.className || "").slice(0, 70) };
});
console.log("searchField:", JSON.stringify(field));
await browser.close();
