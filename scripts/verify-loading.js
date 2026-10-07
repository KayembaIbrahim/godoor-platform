// Determines precisely WHICH loading states never resolve on /app.
const { chromium } = require("playwright");
const EXEC = require("fs").readFileSync("/tmp/chromepath", "utf8").trim();

(async () => {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
  });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

  const timings = [];
  page.on("requestfinished", async (r) => {
    try {
      const resp = await r.response();
      timings.push({ url: r.url().replace("https://godoor.site", ""), status: resp && resp.status(), t: Date.now() });
    } catch {}
  });

  await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });

  // Sample the loading markers over time to see which persist.
  for (const wait of [2000, 5000, 10000, 15000]) {
    await page.waitForTimeout(wait === 2000 ? 2000 : wait - 2000);
    const snap = await page.evaluate(() => {
      const t = document.body.innerText;
      const stuck = [];
      for (const marker of ["Finding shops near you", "Loading recent orders", "LOADING BUSINESSES", "Loading merchants", "Fetching", "…"]) {
        if (t.includes(marker)) stuck.push(marker);
      }
      const chips = Array.from(document.querySelectorAll("button")).map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter((x) => /^\d+$/.test(x));
      return { stuck, chips, len: t.length };
    });
    console.log(`t=${wait}ms  stuck=${JSON.stringify(snap.stuck)}  countChips=${JSON.stringify(snap.chips)}`);
  }

  console.log("\n=== NETWORK ===");
  console.log(timings.map((x) => x.status + "  " + x.url).join("\n"));

  // Now click "All products" - the button the owner says 404s / errors.
  console.log("\n=== CLICKING 'All products' ===");
  try {
    const el = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll("button,a,div,span"));
      return all.find((e) => (e.innerText || "").trim() === "All products") || null;
    });
    const target = el.asElement();
    if (!target) { console.log("BUTTON NOT FOUND"); }
    else {
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await target.click();
      await page.waitForTimeout(4000);
      const after = await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 500),
      }));
      console.log("URL after click:", after.url);
      console.log("TEXT:", after.text.replace(/\n{2,}/g, "\n"));
    }
  } catch (e) {
    console.log("CLICK FAILED:", e.message);
  }

  await browser.close();
})().catch((e) => { console.error("HARNESS ERROR:", e.message); process.exit(1); });