// Verifies the CUSTOMER home (/app) — the screen the user actually complained
// about — in a real signed-in browser on live. Measures computed style and DOM
// geometry, because the agent has no image input and cannot judge by eye.
import { chromium } from "playwright";

const EXEC = "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";
const EMAIL = process.env.GD_EMAIL;
const PASS = process.env.GD_PASS;

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });

// Sign in through the app's own modal.
const dlg = page.locator('[role="dialog"]').first();
if (await dlg.isVisible().catch(() => false)) {
  const signInTab = dlg.getByRole("button", { name: /^sign in$/i }).first();
  if (await signInTab.count()) await signInTab.click().catch(() => {});
  await dlg.locator('input[type="email"]').first().fill(EMAIL);
  await dlg.locator('input[type="password"]').first().fill(PASS);
  await dlg.getByRole("button", { name: /^sign in$/i }).last().click().catch(() => {});
  await page.waitForTimeout(6000);
}

const res = await page.evaluate(() => {
  const out = {};
  out.url = location.pathname;

  // 1. Is the header actually STICKY now? It was `relative`, so it scrolled away.
  const hdr = document.querySelector("header");
  if (hdr) {
    const cs = getComputedStyle(hdr);
    out.headerPosition = cs.position;
    out.headerTop = cs.top;
    const hf = getComputedStyle(hdr, "::before");
    void hf;
    out.headerHasGlassClass =
      hdr.className.includes("nav-glass") && hdr.className.includes("sticky");
    // backdrop-filter is the actual "glassy" signal
    out.headerBackdrop = (cs.backdropFilter || cs.webkitBackdropFilter || "none").slice(0, 40);
  }

  // 2. The bottom nav — the user said "I need glass like nav bars".
  const navs = [...document.querySelectorAll("nav")];
  const bottom = navs.find((n) => {
    const p = getComputedStyle(n).position;
    return p === "fixed";
  });
  if (bottom) {
    const cs = getComputedStyle(bottom);
    out.bottomNav = {
      cls: bottom.className.slice(0, 60),
      backdrop: (cs.backdropFilter || cs.webkitBackdropFilter || "none").slice(0, 30),
    };
  } else out.bottomNav = null;

  // 3. Service tiles: tinted plate + coloured icon (modern) vs solid circle (old).
  const aria = [...document.querySelectorAll('a[aria-label^="Go"], button[aria-label^="Go"], button[aria-label^="Airtime"]')];
  out.tiles = aria.slice(0, 8).map((el) => {
    const cs = getComputedStyle(el);
    const ic = el.querySelector("svg");
    const ics = ic ? getComputedStyle(ic) : null;
    return {
      name: el.getAttribute("aria-label"),
      radius: cs.borderTopLeftRadius,
      iconColor: ics ? ics.color : null,
    };
  });
  out.solidCircles = out.tiles.filter((t) => parseFloat(t.radius) >= 24).length;

  // 4. Faded icon fallbacks — the near-invisible 30% opacity bug.
  out.fadedIcons = [...document.querySelectorAll("svg")].filter((s) => {
    const m = getComputedStyle(s).fillOpacity;
    const o = getComputedStyle(s).opacity;
    return (m && parseFloat(m) < 0.45 && parseFloat(m) > 0) || (o && parseFloat(o) < 0.45 && parseFloat(o) > 0);
  }).length;

  // 5. Hygiene
  out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.h1 = document.querySelectorAll("h1").length;
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log("pageerrors:", errors.length ? errors : "none");
await browser.close();