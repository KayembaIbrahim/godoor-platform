/**
 * Check that the catalogue rail carries NO arrow affordance — and that it is
 * still perfectly usable without one.
 *
 * WHY THIS EXISTS
 * ---------------
 * The services row on the customer home is a horizontal rail that overflows on
 * every phone. It used to carry floating circular chevron buttons on either
 * edge as a "you can slide" hint. The design call changed: the arrows were
 * clutter — they floated over the tiles with their own shadow and the row read
 * busier than the catalogue it was pointing at.
 *
 * So the invariant has INVERTED. The thing to verify is now:
 *
 *   1. There is NO arrow button anywhere near the rail. Not a "Scroll services
 *      right" control, not a floating chevron overlay, not an arrow glyph
 *      parked on the edge.
 *   2. The rail still OVERFLOWS (the content did not shrink to fit).
 *   3. The rail still SCROLLS — natively, by swipe. Removing the buttons must
 *      not remove the capability they were hinting at.
 *
 * That last one is the one that actually matters. Deleting an affordance is
 * easy; deleting the affordance's subject by accident is a real regression,
 * and only a browser can tell the difference.
 *
 * Usage:
 *   node tools/qa/check-rail-clean.mjs
 *   BASE_URL=https://godoor.site node tools/qa/check-rail-clean.mjs
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

console.log("\n── Services rail: no arrows, still scrollable ─────────────────────\n");

await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(3000);

const rail = page.locator('[aria-label="GoDoor services"]');

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

/* ── 1. No arrow affordance anywhere near the rail ──────────────────────────
   Checked three ways, because an arrow can hide in any of them:
     a. the named buttons the old affordance used
     b. any floating (absolutely positioned) button sitting on the rail
     c. an arrow GLYPH parked inside or beside the rail                 */
const namedArrows = await page.getByRole("button", { name: /scroll services/i }).count();
check("there is no 'scroll services' button", namedArrows === 0,
  `found ${namedArrows}`);

const railBox = await rail.boundingBox();

/* Any button that overlaps the rail's box but is NOT a descendant of it is a
   floating overlay — exactly the shape the old chevron buttons had. */
const floatingArrows = await page.evaluate((box) => {
  if (!box) return [];
  const hits = [];
  for (const el of document.querySelectorAll("button, a")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const overlaps =
      r.left < box.x + box.width && r.right > box.x &&
      r.top < box.y + box.height && r.bottom > box.y;
    if (!overlaps) continue;
    const inRail = el.closest('[aria-label="GoDoor services"]');
    if (inRail) continue;           /* the tiles themselves are fine */
    /* Ignore anything that is not arrow-shaped: a 40px-wide circular control
       parked on the rail edge is the thing we are hunting. */
    if (r.width <= 44 && r.height <= 44) {
      hits.push({
        label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || "(unlabelled)",
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }
  return hits;
}, railBox);
check("no floating arrow button overlaps the rail", floatingArrows.length === 0,
  floatingArrows.length ? JSON.stringify(floatingArrows) : "");

/* An arrow glyph inside the rail would show up as an SVG in the rail that is
   not one of the eight service icons. The service tiles each hold exactly one
   SVG (the lucide icon inside the disc); anything more is decoration. */
const strayGlyphs = await rail.evaluate((el) => {
  const svgs = el.querySelectorAll("svg");
  return svgs.length - el.querySelectorAll('[role="listitem"] > a svg, [role="listitem"] > button svg').length;
});
check("no stray arrow glyph inside the rail", strayGlyphs === 0,
  `${strayGlyphs} stray svg(s)`);

/* ── 2. The rail still overflows — the content did not shrink to fit ─────── */
const overflows = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
check("the rail still overflows (there is more to see)", overflows > 4,
  `overflow ${overflows}px`);

/* ── 3. The rail still scrolls natively ─────────────────────────────────────
   The capability the arrows were hinting at must survive their removal. */
const scrollable = await rail.evaluate((el) => {
  const before = el.scrollLeft;
  el.scrollLeft = Math.round(el.clientWidth * 0.6);
  const after = el.scrollLeft;
  el.scrollLeft = before;
  return { before, after, overflowX: getComputedStyle(el).overflowX };
});
check("the rail scrolls natively", scrollable.after > scrollable.before,
  `scrollLeft ${scrollable.before} → ${scrollable.after}`);
check("the rail keeps a horizontal overflow", scrollable.overflowX.includes("auto") || scrollable.overflowX.includes("scroll"),
  `overflow-x: ${scrollable.overflowX}`);

/* And it scrolls back to the start, so a swiped rail is not a stuck rail.
   The rail carries px-4 padding and snap-start items, so the browser's first
   snap point is one padding step in (16px), not a hard zero. Anything near the
   left edge counts as "back at the start". */
const returned = await rail.evaluate((el) => {
  el.scrollLeft = el.scrollWidth;
  el.scrollLeft = 0;
  return el.scrollLeft;
});
const leftPad = await rail.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft) || 0);
check("the rail returns to the start", returned <= leftPad + 1, `scrollLeft ${returned} (pad ${leftPad})`);

await browser.close();
if (server) server.kill("SIGTERM");

console.log(`\n${failed === 0 ? "PASS" : `FAIL — ${failed} problem(s)`}\n`);
process.exit(failed === 0 ? 0 : 1);
