/**
 * Measure the bottom-nav label geometry in a real browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * The complaint was "the nav labels are cut off". That is a claim about
 * rendered pixels, not about class names, so it has to be measured in a
 * browser at the widths people actually use. A label that is `whitespace-nowrap`
 * inside a `flex-1` tab does NOT get truncated — it OVERFLOWS its tab and
 * lands on top of its neighbour, which looks exactly like a cut-off word. And
 * a label carrying `truncate` IS cut off, silently, with an ellipsis.
 *
 * So the question this script answers, per label, is:
 *
 *      does the text box fit inside the slot it is supposed to live in?
 *
 * and, secondarily, how much room is actually left on the bar so a fix can be
 * aimed at the real constraint instead of guessed at.
 *
 * IT BOOTS ITS OWN SERVER
 * -----------------------
 * A `next dev` started from the shell does not survive the shell exiting,
 * so measuring meant racing the process manager. This script starts the dev
 * server as its own child process, waits for it to answer, measures, and
 * then shuts it down — one process, one lifetime, no race.
 *
 * Usage:
 *   node tools/qa/measure-nav.mjs                       # local, all roles
 *   BASE_URL=https://godoor.site node tools/qa/measure-nav.mjs
 *   ROLE=business node tools/qa/measure-nav.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const ONLY = process.env.ROLE || "";
const EXTERNAL = process.env.BASE_URL || "";

/**
 * Each role's nav: the route that renders it and its aria-label.
 *
 * The rider is measured on `/rider/earnings` rather than `/rider`. The rider
 * dashboard renders its nav only for a signed-in rider — signed out it shows
 * a "Register as a rider" panel with no nav at all — so measuring `/rider`
 * would silently measure nothing and report a pass. The earnings page mounts
 * the same `RiderNav` unconditionally, so it is the honest place to measure.
 */
const ROLES = [
  { role: "customer", path: "/app", label: "Bottom Navigation" },
  { role: "rider", path: "/rider/earnings", label: "Rider sections" },
  { role: "business", path: "/business", label: "Business sections" },
];

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

const WIDTHS = [320, 360, 390, 414, 480, 768];

/**
 * Read the nav's geometry out of the live DOM.
 *
 * This is ONE self-contained function because `page.evaluate` serialises only
 * the function it is given — it cannot reach a sibling defined in this module.
 *
 * A nav that is present in the DOM but not rendered (the business bar is
 * `md:hidden`) is reported as absent: measuring a `display:none` element
 * yields a 0-width box, and every label then "overflows" a zero-width slot —
 * a false failure that has nothing to do with the label.
 */
function readNav(NAV_LABEL) {
  const nav = document.querySelector(`nav[aria-label="${NAV_LABEL}"]`);
  if (!nav) return null;
  const navBox = nav.getBoundingClientRect();
  if (navBox.width === 0 && navBox.height === 0) return null;

  const bar = nav.querySelector(":scope > div");
  if (!bar) return null;

  const slab = bar.querySelector(".nav3d");
  const floats = bar.querySelectorAll(".nav3d-float");

  const links = Array.from(nav.querySelectorAll("a[href]"));
  const tabs = links
    .filter((a) => a.querySelector(".nav3d-item"))
    .map((a) => {
      const item = a.querySelector(".nav3d-item");
      const label = item.querySelector("span:last-child");
      const text = (label?.textContent || "").trim();
      const labelBox = label?.getBoundingClientRect();
      const itemBox = item.getBoundingClientRect();
      /* The slot the label must fit into: the tab's inner width minus the
         item's horizontal padding. */
      const cs = getComputedStyle(item);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const slot = itemBox.width - padX;
      const lcs = label ? getComputedStyle(label) : null;
      return {
        text,
        itemWidth: +itemBox.width.toFixed(1),
        labelWidth: labelBox ? +labelBox.width.toFixed(1) : 0,
        slot: +slot.toFixed(1),
        /* Positive => the word is wider than its slot => it overlaps. */
        overflow: +(labelBox ? labelBox.width - slot : 0).toFixed(1),
        fontSize: lcs ? lcs.fontSize : "?",
        /* `truncate` is a silent cut-off: the text is ellipsised and the
           reader never sees the whole word. */
        truncated: !!lcs && lcs.textOverflow === "ellipsis",
        nowrap: !!lcs && lcs.whiteSpace === "nowrap",
      };
    });

  return {
    barWidth: +bar.getBoundingClientRect().width.toFixed(1),
    slabWidth: slab ? +slab.getBoundingClientRect().width.toFixed(1) : 0,
    floatCount: floats.length,
    tabs,
  };
}

/* ── The server ───────────────────────────────────────────────────────── */

let server = null;
let BASE = EXTERNAL;

async function startServer() {
  const PORT = 3411;
  BASE = `http://127.0.0.1:${PORT}`;
  /* Spawn the local Next binary directly rather than through `npx`, so the
     child needs no shell and cannot fail on a PATH lookup. */
  const nextBin = new URL("../../node_modules/next/dist/bin/next", import.meta.url).pathname;
  server = spawn(process.execPath, [nextBin, "dev", "--webpack", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let log = "";
  server.stdout.on("data", (d) => { log += d.toString(); });
  server.stderr.on("data", (d) => { log += d.toString(); });

  /* Wait for the port to answer. The first request compiles, so this can take
     a while — the timeout is generous on purpose. */
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`dev server exited (${server.exitCode}):\n${log.slice(-2000)}`);
    }
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30000) });
      if (r.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server did not start in time:\n${log.slice(-2000)}`);
}

if (!EXTERNAL) {
  await startServer();
}

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);

let bad = 0;
/** Roles whose nav was actually found and measured. A role that never renders
 *  its nav must NOT be reported as a pass — measuring nothing looks exactly
 *  like measuring something that fits. */
const measured = new Set();

for (const r of ROLES) {
  if (ONLY && r.role !== ONLY) continue;
  console.log(`\n══ ${r.role}  (${r.path}) ══`);
  await page.goto(`${BASE}${r.path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(250);
    const res = await page.evaluate(readNav, r.label);
    console.log(`\n── ${r.role} @ ${w}px ──`);
    if (!res) {
      console.log("  (nav not visible at this width)");
      continue;
    }
    measured.add(r.role);
    console.log(`  bar ${res.barWidth}px · slab ${res.slabWidth}px · floats ${res.floatCount}`);
    for (const t of res.tabs) {
      const fits = t.overflow <= 0.5;
      if (!fits) bad++;
      const flags = [t.truncated ? "TRUNCATED" : "", t.nowrap ? "nowrap" : ""].filter(Boolean).join(" ");
      console.log(
        `  ${fits ? "ok  " : "OVER"} "${t.text}"  label ${t.labelWidth}px / slot ${t.slot}px  (${t.fontSize})  overflow ${t.overflow > 0 ? "+" : ""}${t.overflow}px  ${flags}`,
      );
    }
  }
}

await browser.close();
if (server) {
  server.kill("SIGTERM");
}

/* A role whose nav never rendered was never checked. Say so, and fail — an
   unmeasured role is not a passing role. */
for (const r of ROLES) {
  if (ONLY && r.role !== ONLY) continue;
  if (!measured.has(r.role)) {
    bad++;
    console.log(`\n✗ the ${r.role} nav was never rendered on ${r.path} — it was NOT measured`);
  }
}

console.log(`\n${bad === 0 ? "PASS — every label fits its slot" : `FAIL — ${bad} problem(s)`}`);
process.exit(bad === 0 ? 0 : 1);
