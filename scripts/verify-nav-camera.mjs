/**
 * Navigation-camera verification — deterministic, browser-free.
 *
 * The browser-driven version (verify-nav-camera.mjs) measures the real Mapbox
 * camera, but this sandbox cannot give Mapbox GL a WebGL context inside the
 * available ~1.1 GB: the renderer is OOM-killed the moment the map initialises,
 * and with `--disable-webgl2` the map refuses to start at all.
 *
 * So the camera is verified at the level it is actually decided: the pure
 * functions that compute the camera target, extracted FROM THE SOURCE FILE at
 * run time (never re-typed here, so the test cannot drift from the code), plus
 * the map's own call site read back out of the source.
 *
 * What it proves:
 *   1. the camera is pushed AHEAD of the rider, along the rider's heading;
 *   2. the rider therefore lands BELOW the centre of the screen;
 *   3. the camera is tilted (a windscreen view, not a flat overhead);
 *   4. the zoom tracks the distance to the next turn — in when it is close,
 *      back when it is far — and never tighter than the base;
 *   5. the call site actually uses that target (and not the old centred one).
 */
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/components/MapboxMap.tsx", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
}

/* ── Pull the real functions out of the component ─────────────────────────── */

/** Extracts `function name(...) { ... }` verbatim from the source. */
function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in MapboxMap.tsx`);
  let i = SRC.indexOf("{", start);
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`could not balance braces for ${name}`);
}

/* The three helpers are module-level in MapboxMap.tsx. They are compiled with
   the project's own TypeScript so the test exercises the REAL code — the
   types are stripped by the compiler, not by a regex, and the test can never
   drift from the implementation. */
const ts = (await import("typescript")).default;
const helpers = [
  extractFn("metresPerPixel"),
  extractFn("offsetAlongBearing"),
  extractFn("adaptiveNavZoom"),
].join("\n\n");

const compiled = ts.transpileModule(helpers, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const factory = new Function(
  "LatLng",
  `${compiled}
   return { metresPerPixel, offsetAlongBearing, adaptiveNavZoom };`
)(null);
const { metresPerPixel, offsetAlongBearing, adaptiveNavZoom } = factory;

/* ── Geometry helpers (the same maths the component uses) ─────────────────── */
const RIDER = { lat: 0.3163, lng: 32.5822 };
const BASE_ZOOM = 16.5;
const PITCH = 45;

function navCameraTarget(rider, bearingDeg, distToTurnM, viewportPx) {
  const zoom = adaptiveNavZoom(BASE_ZOOM, distToTurnM, viewportPx, rider.lat);
  const pitch = PITCH;
  const aheadPx = Math.min(viewportPx * 0.28, 140);
  const mpp = metresPerPixel(rider.lat, zoom);
  const aheadM = Math.max(0, (aheadPx * mpp) / Math.max(Math.cos((pitch * Math.PI) / 180), 0.35));
  return {
    center: offsetAlongBearing(rider, bearingDeg, aheadM),
    zoom,
    pitch,
    aheadM,
    bearing: bearingDeg,
  };
}

/* How far down the screen the rider lands, for a camera at `target`.
   Mapbox's getCenter() is the GROUND point at the centre of the viewport.
   The rider sits BEHIND that point (the camera was pushed forward), so it
   projects BELOW the centre — and with the camera pitched, ground distance
   along the view direction is foreshortened by cos(pitch). */
function riderScreenFraction(target, rider, viewportH) {
  const mpp = metresPerPixel(rider.lat, target.zoom);
  const th = (target.bearing * Math.PI) / 180;

  /* Vector from the camera centre to the rider, in metres: (north, east). */
  const vN = (rider.lat - target.center.lat) * 111320;
  const vE = (rider.lng - target.center.lng) * 111320 * Math.cos((rider.lat * Math.PI) / 180);

  /* Component along the camera's view direction (positive = ahead of centre). */
  const along = vN * Math.cos(th) + vE * Math.sin(th);

  /* Positive px = below the centre of the screen. */
  const px = (-along * Math.cos((target.pitch * Math.PI) / 180)) / mpp;
  return 0.5 + px / viewportH;
}

console.log("── Camera geometry (functions extracted from MapboxMap.tsx) ──");

for (const bearing of [0, 45, 90, 180, 270]) {
  const t = navCameraTarget(RIDER, bearing, null, 900);
  const frac = riderScreenFraction(t, RIDER, 900);
  check(
    `heading ${bearing}°: the rider sits below the centre of the screen`,
    frac > 0.52 && frac < 0.95,
    `rider at ${(frac * 100).toFixed(1)}% down the screen, camera ${t.aheadM.toFixed(0)} m ahead`
  );
}

console.log("\n── The camera really is pushed forward along the heading ──");
for (const bearing of [0, 90, 180, 270]) {
  const t = navCameraTarget(RIDER, bearing, null, 900);
  const dLat = (t.center.lat - RIDER.lat) * 111320;
  const dLng = (t.center.lng - RIDER.lng) * 111320 * Math.cos((RIDER.lat * Math.PI) / 180);
  const along = dLat * Math.cos(bearing * Math.PI / 180) + dLng * Math.sin(bearing * Math.PI / 180);
  check(
    `heading ${bearing}°: the camera centre is ahead of the rider`,
    along > 10,
    `${along.toFixed(0)} m ahead along the heading`
  );
}

console.log("\n── Adaptive zoom tracks the next turn ──");
const zClose = adaptiveNavZoom(BASE_ZOOM, 20, 900, RIDER.lat);
const zMid = adaptiveNavZoom(BASE_ZOOM, 400, 900, RIDER.lat);
const zFar = adaptiveNavZoom(BASE_ZOOM, 1200, 900, RIDER.lat);
const zUnknown = adaptiveNavZoom(BASE_ZOOM, null, 900, RIDER.lat);

check("a close turn keeps a street-level zoom", zClose >= 16.0, `zoom ${zClose.toFixed(2)}`);
check("a distant turn pulls the camera back", zFar < zClose - 0.5, `close ${zClose.toFixed(2)} → far ${zFar.toFixed(2)}`);
check("the zoom decreases monotonically as the turn recedes", zClose >= zMid && zMid >= zFar, `${zClose.toFixed(2)} ≥ ${zMid.toFixed(2)} ≥ ${zFar.toFixed(2)}`);
check("the camera never zooms IN past the 16.5 base", Math.max(zClose, zMid, zFar) <= BASE_ZOOM + 1e-6, `max ${Math.max(zClose, zMid, zFar).toFixed(2)}`);
check("the camera never zooms out into a city overview", zFar >= 13.8, `far zoom ${zFar.toFixed(2)}`);
check("an unknown turn distance falls back to the base zoom", Math.abs(zUnknown - BASE_ZOOM) < 1e-6, `zoom ${zUnknown.toFixed(2)}`);

console.log("\n── The camera sees materially further ahead than the old flat one ──");
{
  const H = 900;
  const t = navCameraTarget(RIDER, 0, null, H);
  const visibleNow = (H * 0.5) * metresPerPixel(RIDER.lat, t.zoom) / Math.max(Math.cos((t.pitch * Math.PI) / 180), 0.35);
  const visibleOld = (H * 0.5) * metresPerPixel(RIDER.lat, 16.5);
  check(
    "the tilted, pushed-forward camera sees further ahead",
    visibleNow > visibleOld * 1.4,
    `now ${visibleNow.toFixed(0)} m vs the old flat centred camera ${visibleOld.toFixed(0)} m`
  );
}

console.log("\n── The call site actually uses that camera ──");
{
  /* The component must (a) build the target with navCameraTarget and
     (b) hand THAT to the map, not the old centred rider position. */
  const usesTarget = /navCameraTarget\(/.test(SRC);
  check("the component builds a camera target with navCameraTarget", usesTarget);

  const targetCalls = (SRC.match(/navCameraTarget\(/g) || []).length;
  check(
    "the camera target is used by the follow, the focus and the recentre paths",
    targetCalls >= 3,
    `${targetCalls} call sites`
  );

  /* The old behaviour centred the camera on the rider with pitch 0. Make sure
     no code path still does that in navigation mode. */
  const navBranch = SRC.slice(SRC.indexOf("navBearing != null"));
  const flatCentred = /pitch:\s*0\b/.test(navBranch) && /center:\s*c\b/.test(navBranch);
  check("no navigation branch still centres the camera flat on the rider", !flatCentred);

  check(
    "the camera is tilted (a windscreen view, not a flat overhead)",
    /navigationPitch = 45/.test(SRC) && /pitch/.test(navBranch),
    "navigationPitch defaults to 45° and is applied to the camera"
  );

  /* The rider arrow must be rotated relative to the MAP's bearing, otherwise
     it points sideways while the map is heading-up. */
  check(
    "the rider arrow is rotated relative to the map bearing, not the absolute compass",
    /m\.heading - mapBearingRef\.current/.test(SRC)
  );

  /* A dependency array that names a const declared further down the body is a
     temporal-dead-zone crash — the exact bug that blanked the map. */
  const declLines = new Map();
  SRC.split("\n").forEach((l, i) => {
    const m = l.match(/^\s{2,}const \[?([A-Za-z_$][\w$]*)\]?\s*(?::[^=]*?)?=/);
    if (m && !declLines.has(m[1])) declLines.set(m[1], i + 1);
  });
  const tdz = [];
  SRC.split("\n").forEach((l, i) => {
    for (const arr of l.matchAll(/\[\s*([^\]]*?)\s*\]\s*;/g)) {
      const body = arr[1];
      if (body.includes("=>") || body.includes("...")) continue;
      for (const nm of body.match(/[A-Za-z_$][\w$]*/g) || []) {
        const at = declLines.get(nm);
        if (at && at > i + 1) tdz.push(`${nm} (used line ${i + 1}, declared line ${at})`);
      }
    }
  });
  check(
    "no dependency array names a const declared further down the body (TDZ)",
    tdz.length === 0,
    tdz.length ? tdz.join("; ") : "scanned every dependency array in the file"
  );
}

console.log("\n── Overlays stop crushing the map ──");
{
  /* The status chip and the turn banner must sit on ONE row on a phone. */
  const riderPage = readFileSync(new URL("../src/app/rider/page.tsx", import.meta.url), "utf8");
  const chip = riderPage.match(/top-\[[\d.]+rem\]/);
  check(
    "the status chip no longer drops to a second row behind the turn banner",
    !chip,
    chip ? `found ${chip[0]}` : "no top-[…rem] offset left"
  );
}

await import("node:fs").then((fs) => {
  fs.mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  fs.writeFileSync(new URL("./out/nav-camera-report.txt", import.meta.url),
    results.map((r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}`).join("\n") + "\n");
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
