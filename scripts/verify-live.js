// Live smoke test for the GoDoor customer home screen.
// Drives the real deployed site in Chromium and reports what actually renders,
// rather than what we hope renders.
const { chromium } = require("playwright");

const EXEC = require("fs").readFileSync("/tmp/chromepath", "utf8").trim();

(async () => {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(r.status() + " " + r.url().slice(0, 110));
  });

  await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  const bodyText = await page.evaluate(() => document.body.innerText);

  // Every internal link on the page must resolve to a real route.
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))
  );
  const internal = Array.from(new Set(links.filter((h) => h && h.startsWith("/"))));

  // Dead internal links: verified against real HTTP responses below.
  const linkChecks = [];
  for (const href of internal) {
    const res = await page.request.get("https://godoor.site" + href, { maxRedirects: 0 }).catch(() => null);
    linkChecks.push({ href, status: res ? res.status() : "ERR" });
  }

  const services = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a.innerText || "").replace(/\s+/g, " ").trim())
      .filter((t) => /GoRide|GoFood|GoMart|GoExpress|GoPharma|GoPay|GoCar|Airtime/i.test(t))
      .slice(0, 12)
  );

  console.log("=== ERRORS (" + errors.length + ") ===");
  console.log([...new Set(errors)].slice(0, 15).join("\n") || "(none)");
  console.log("\n=== FAILED REQUESTS (" + failedRequests.length + ") ===");
  console.log([...new Set(failedRequests)].slice(0, 15).join("\n") || "(none)");
  console.log("\n=== INTERNAL LINKS (" + internal.length + ") ===");
  console.log(linkChecks.map((l) => l.status + "  " + l.href).join("\n"));
  console.log("\n=== SERVICES VISIBLE ===");
  console.log(services.join(" | ") || "(none)");
  console.log("\n=== WALLET / BODY SNIPPET ===");
  console.log(bodyText.replace(/\n{2,}/g, "\n").slice(0, 900));

  await browser.close();
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});