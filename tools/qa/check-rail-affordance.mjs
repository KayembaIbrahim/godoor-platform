/**
 * Check the services rail's scroll affordance in a real browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * The complaint was "the catalog has no arrow, so you cannot tell you can
 * slide to see more". The services row on the customer home is a horizontal
 * rail that overflows on every phone, and without a hint the last visible
 * tile reads as the last tile there is.
 *
 * Three things have to be true at once, and only a browser can tell:
 *
 *   1. The trailing chevron is VISIBLE while there is more to the right.
 *   2. It is GONE once the rail is scrolled to its end — a chevron that is
 *      always on screen is decoration, not information.
 *   3. Pressing it actually MOVES the rail. An arrow that does nothing is
 *      worse than no arrow, because it teaches people that arrows are noise.
 *
 * Usage:
 *   node tools/qa/check-rail-affordance.mjs
 *   BASE_URL=https://godoor.site node tools/qa/check-rail-affordance.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const EXTERNAL = process.env.BASE_URL || "";

const LAUNCH = {
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-zygote",
    "--renderer-process-limit=1",
  ],
};

let server = null;
let BASE = EXTERNAL;
let serverLog = "";

async function startServer() {
  const PORT = 3412;
  BASE = `http://127.0.0.1:${PORT}`;
  const nextBin = new URL("../../node_modules/next/dist/bin/next", import.meta.url).pathname;
  server = spawn(process.execPath, [nextBin, "dev", "--webpack", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  server.stdout.on("data", (d) => { serverLog += d.toString(); });
  server.stderr.on("data", (d) => { serverLog += d.toString(); });

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`dev server exited (${server.exitCode}):\n${serverLog.slice(-3000)}`);
    }
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30000) });
      if (r.status > 0) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server did not start in time:\n${serverLog.slice(-3000)}`);
}

if (!EXTERNAL) await startServer();

let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);

/* A dev server that was OOM-killed mid-compile renders an error page, and the
   rail is simply "not present". That is a broken environment, not a broken
   affordance, so the server's own complaints are reported rather than
   silently counted as a failure of the thing under test. */
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });

console.log("\n── Services rail scroll affordance ────────────────────────────\n");

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(3000);

const rail = page.locator('[aria-label="GoDoor services"]');
const next = page.getByRole("button", { name: "Scroll services right" });
const prev = page.getByRole("button", { name: "Scroll services left" });

if ((await rail.count()) === 0) {
  console.log("  FAIL the services rail is present");
  console.log("\n── server log ─────────────────────────────────────────────");
  console.log(serverLog.slice(-3000));
  console.log("\n── page errors ───────────────────────────────────────────");
  console.log(pageErrors.slice(0, 5).join("\n"));
  await browser.close();
  if (server) server.kill("SIGTERM");
  process.exit(1);
}
check("the services rail is present", true);

if ((await rail.count()) > 0 && (await next.count()) > 0) {
  const overflows = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
  check("the rail actually overflows (so the hint is warranted)", overflows > 4,
    `overflow ${overflows}px`);

  /* Visible at the start? */
  const opacityAtStart = await next.evaluate((el) => getComputedStyle(el).opacity);
  check("the trailing chevron is visible at the start", parseFloat(opacityAtStart) > 0.5,
    `opacity ${opacityAtStart}`);

  /* Pressing it must move the rail. */
  const before = await rail.evaluate((el) => el.scrollLeft);
  await next.click({ force: true });
  await page.waitForTimeout(900);
  const after = await rail.evaluate((el) => el.scrollLeft);
  check("pressing the chevron scrolls the rail", after > before,
    `scrollLeft ${before} → ${after}`);

  /* At the very end the chevron must be gone. */
  await rail.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(900);
  const opacityAtEnd = await next.evaluate((el) => getComputedStyle(el).opacity);
  check("the trailing chevron is gone at the end of the rail", parseFloat(opacityAtEnd) < 0.2,
    `opacity ${opacityAtEnd}`);

  /* And the leading chevron must appear once scrolled away from the start. */
  const prevOpacity = await prev.evaluate((el) => getComputedStyle(el).opacity);
  check("the leading chevron appears once scrolled", parseFloat(prevOpacity) > 0.5,
    `opacity ${prevOpacity}`);

  /* Back to the start: the leading chevron must go away again. */
  await rail.evaluate((el) => { el.scrollLeft = 0; });
  await page.waitForTimeout(900);
  const prevOpacityStart = await prev.evaluate((el) => getComputedStyle(el).opacity);
  check("the leading chevron is gone at the start", parseFloat(prevOpacityStart) < 0.2,
    `opacity ${prevOpacityStart}`);
}

await browser.close();
if (server) server.kill("SIGTERM");

console.log(`\n${failed === 0 ? "PASS" : `FAIL — ${failed} problem(s)`}\n`);
process.exit(failed === 0 ? 0 : 1);
