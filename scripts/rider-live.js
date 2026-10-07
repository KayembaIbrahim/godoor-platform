const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));

  await page.goto("https://godoor.site/rider", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);

  const before = await page.evaluate(() => ({
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
    buttons: Array.from(document.querySelectorAll("button")).map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean).slice(0, 25),
    mapPresent: !!document.querySelector("#rider-boda-map"),
  }));

  // Open the Boda tab, if the rider page exposes one.
  const boda = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /^\s*boda\s*$/i.test(x.innerText || ""));
    if (b) { b.click(); return "clicked"; }
    return "not-found";
  });
  await page.waitForTimeout(7000);

  const after = await page.evaluate(() => {
    const m = document.querySelector("#rider-boda-map");
    const canvas = m ? m.querySelector("canvas") : null;
    const r = m ? m.getBoundingClientRect() : null;
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      mapPresent: !!m,
      mapHeight: r ? Math.round(r.height) : 0,
      mapTop: r ? Math.round(r.top) : -1,
      mapVisibleOnScreen: r ? r.top < window.innerHeight && r.bottom > 0 : false,
      viewportH: window.innerHeight,
      canvasPainted: canvas ? canvas.width > 0 : false,
      authBanner: /sign in to continue/i.test(t),
      // Is the map above the request list? (map-first)
      mapBeforeRequests: (() => {
        const map = document.querySelector("#rider-boda-map");
        if (!map) return "n/a";
        const h = Array.from(document.querySelectorAll("h3")).find((x) => /Passenger requests/.test(x.innerText || ""));
        if (!h) return "no-list";
        return (map.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) ? "map-first" : "list-first";
      })(),
      stuck: Array.from(document.querySelectorAll(".animate-spin")).length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      text: t.slice(0, 260),
    };
  });

  console.log(JSON.stringify({ before, bodaClick: boda, after, errors: errs.slice(0, 4) }, null, 2));
  await browser.close();
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });