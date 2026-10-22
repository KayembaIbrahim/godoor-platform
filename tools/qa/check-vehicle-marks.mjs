/**
 * Geometric self-check for the vehicle marker silhouettes.
 *
 * WHY THIS IS A SCRIPT AND NOT A LOOK
 * -----------------------------------
 * A marker that is 3px off-centre, or whose wheels poke outside the tile, or
 * whose shadow swings visibly when the rider turns, cannot be caught by
 * reading path data — but it can be caught by measuring the rendered SVG.
 * So this measures every silhouette in a real browser and asserts the
 * properties the map depends on:
 *
 *   1. nothing spills outside the 48x48 tile (it would be clipped by the
 *      marker element, or overlap a neighbouring pin);
 *   2. the drawing is centred on (24, 24) — the anchor, which is the GPS
 *      point, so an off-centre drawing puts the rider in the wrong place;
 *   3. the silhouette fills a sensible share of the tile — too small is
 *      unreadable at map zoom, too big is clipped by the marker box;
 *   4. the shadow is rotation-invariant, so turning the rider does not drag
 *      the shadow across the road.
 *
 * Usage: node tools/qa/check-vehicle-marks.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const ts = (await import("typescript")).default;
const src = readFileSync("src/components/maps/vehicle-marks.ts", "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const CASES = [
  ["motorbike", "motorbike"],
  ["motorcycle", "motorbike"],
  ["Motor Bike", "motorbike"],
  ["boda", "motorbike"],
  ["moto", "motorbike"],
  ["e-bike", "motorbike"],
  ["car", "car"],
  ["suv", "car"],
  ["bicycle", "bicycle"],
  ["cycle", "bicycle"],
  ["van", "van"],
  ["truck", "van"],
  ["cargo bike", "van"],
  ["foot", "walking"],
  ["on foot", "walking"],
  ["", "motorbike"],
  ["something exotic", "motorbike"],
];

let failures = 0;
const fail = (m) => { console.log("  FAIL " + m); failures++; };
const ok = (m) => console.log("  ok   " + m);

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });

for (const [input, expected] of CASES) {
  console.log(`\n── "${input || "(empty)"}" → ${expected} ──`);

  const kind = mod.vehicleKind(input);
  if (kind !== expected) fail(`vehicleKind("${input}") = ${kind}, expected ${expected}`);
  else ok(`maps to ${kind}`);

  const svg = mod.vehicleSvg({ type: input, size: 96, uid: `t${input || "d"}` });
  await page.setContent(`<body style="margin:0">${svg}</body>`);

  const r = await page.evaluate(() => {
    const s = document.querySelector("svg");
    const box = s.getBBox();                 // union of painted geometry
    const el = s.querySelector("ellipse");   // the contact shadow
    const shadow = el ? el.getBBox() : null;
    /* the wheels are the outermost dark circles; they must be inside the tile */
    const circles = Array.from(s.querySelectorAll("circle")).map((c) => {
      const b = c.getBBox();
      return { cx: +c.getAttribute("cx"), cy: +c.getAttribute("cy"), r: +c.getAttribute("r"), b };
    });
    return {
      box: { x: box.x, y: box.y, w: box.width, h: box.height },
      shadow: shadow ? { cx: +(shadow.x + shadow.width / 2).toFixed(2), cy: +(shadow.y + shadow.height / 2).toFixed(2) } : null,
      wheels: circles.filter((c) => c.r > 2.5),
    };
  });

  /* 1. inside the tile */
  const { x, y, w, h } = r.box;
  if (x < -0.5 || y < -0.5 || x + w > 48.5 || y + h > 48.5) {
    fail(`spills outside the 48x48 tile: bbox=${JSON.stringify(r.box)}`);
  } else ok("fits inside the tile");

  /* 2. centred on the anchor */
  const cx = x + w / 2, cy = y + h / 2;
  if (Math.abs(cx - 24) > 2.5 || Math.abs(cy - 24) > 2.5) {
    fail(`not centred on (24,24): centre=(${cx.toFixed(2)}, ${cy.toFixed(2)})`);
  } else ok(`centred at (${cx.toFixed(1)}, ${cy.toFixed(1)})`);

  /* 3. fills a usable share of the tile */
  const fill = Math.max(w, h) / 48;
  if (fill < 0.6) fail(`too small to read at map zoom (fills ${(fill * 100).toFixed(0)}% of the tile)`);
  else ok(`fills ${(fill * 100).toFixed(0)}% of the tile`);

  /* 4. the shadow sits under the vehicle, not off to one side */
  if (!r.shadow) fail("no contact shadow found");
  else if (Math.abs(r.shadow.cx - 24) > 0.6 || Math.abs(r.shadow.cy - 24) > 0.6) {
    fail(`shadow is off-centre at (${r.shadow.cx}, ${r.shadow.cy}) — it would swing when the rider turns`);
  } else ok("contact shadow is centred (rotation-invariant)");

  /* 5. the wheels are the widest part and they are inside the tile */
  for (const c of r.wheels) {
    if (c.b.x < -0.5 || c.b.y < -0.5 || c.b.x + c.b.width > 48.5 || c.b.y + c.b.height > 48.5) {
      fail(`a wheel at (${c.cx},${c.cy}) r=${c.r} is outside the tile`);
    }
  }
  if (r.wheels.length >= 2) ok(`${r.wheels.length} wheels, all inside the tile`);
}

await browser.close();

console.log(failures === 0 ? "\nPASS — every vehicle silhouette is sound" : `\nFAIL — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
