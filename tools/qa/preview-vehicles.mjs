/**
 * Render every vehicle marker on a map-like background and screenshot it, so
 * the silhouettes can be judged by eye instead of by reading path data.
 *
 * Usage: node tools/qa/preview-vehicles.mjs [outfile]
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.argv[2] || "tools/qa/out/vehicles.png");

/* Pull the SVG builder out of the TS module without a build step: strip the
   type annotations we need gone and evaluate it as a module. */
/* Transpile the TS module with the project's own TypeScript, so the preview
   always renders exactly the code that ships — no hand-rolled regex
   stripping that can silently drift from the source. */
const ts = (await import("typescript")).default;
const src = readFileSync("src/components/maps/vehicle-marks.ts", "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const KINDS = ["motorbike", "motorcycle", "boda", "car", "suv", "bicycle", "van", "truck", "foot", ""];

const cells = KINDS.map((k, i) => {
  const svg = mod.vehicleSvg({ type: k, size: 96, uid: `p${i}` });
  return `<figure><div class="stage">${svg}</div>
    <figcaption>${k || "(default)"} → <b>${mod.vehicleKind(k)}</b></figcaption></figure>`;
}).join("");

const html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;padding:24px;background:#e8eaed;font-family:Inter,system-ui,sans-serif}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:18px}
  figure{margin:0;text-align:center}
  .stage{height:132px;display:grid;place-items:center;border-radius:18px;
    background:linear-gradient(180deg,#f3f4f6,#dfe3e8);
    box-shadow:inset 0 1px 0 #fff, 0 2px 8px rgba(0,0,0,.08)}
  figcaption{font-size:12px;color:#374151;margin-top:6px}
  b{color:#c2410c}
</style>
<div class="grid">${cells}</div>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT.replace(/\.png$/, ".html"), html);

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 520 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: OUT });
await browser.close();
console.log("wrote " + OUT);
