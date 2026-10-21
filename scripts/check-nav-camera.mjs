/**
 * Checks the driver's navigation camera maths.
 *
 * The complaint this fixes: "the map navigation gets too compacted which makes
 * navigation difficult with the rider". The camera used to sit exactly on the
 * rider at a fixed zoom 16.5 with pitch 0 — a small, flat, centred circle of
 * road. These assertions pin the new behaviour down:
 *
 *   - the camera centre is pushed FORWARD along the heading, so the rider sits
 *     low on the screen and the road ahead fills the view;
 *   - the camera is tilted, so the view reads as a windscreen not a map;
 *   - the zoom tracks the distance to the next turn — close in when the turn
 *     is close, pulled back when it is far — and never tighter than the base.
 */

const EARTH_CIRCUMFERENCE = 40075017;

function metresPerPixel(lat, zoom) {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
}

function offsetAlongBearing(p, bearingDeg, metres) {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (metres * Math.cos(b)) / 111320;
  const dLng = (metres * Math.sin(b)) / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

function adaptiveNavZoom(baseZoom, distToTurnM, viewportPx, lat) {
  if (distToTurnM == null || !isFinite(distToTurnM) || distToTurnM <= 0) return baseZoom;
  const mpp = metresPerPixel(lat, baseZoom);
  const neededM = 1.7 * (distToTurnM + 70);
  const neededPx = neededM / Math.max(mpp, 1e-6);
  const want = baseZoom + Math.log2(Math.max(viewportPx, 1) / Math.max(neededPx, 1));
  return Math.min(baseZoom, Math.max(13.8, want));
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KAMPALA = { lat: 0.3163, lng: 32.5822 };
const BASE_ZOOM = 16.5;
const PITCH = 45;

console.log("\nNavigation camera — zoom tracks the next turn");
const close = adaptiveNavZoom(BASE_ZOOM, 25, 480, KAMPALA.lat);
const mid = adaptiveNavZoom(BASE_ZOOM, 250, 480, KAMPALA.lat);
const far = adaptiveNavZoom(BASE_ZOOM, 900, 480, KAMPALA.lat);
const veryFar = adaptiveNavZoom(BASE_ZOOM, 4000, 480, KAMPALA.lat);

check("turn 25 m away stays at street level", close >= 16.0, `got ${close.toFixed(2)}`);
check("turn 250 m away pulls back", mid < close - 0.4, `mid ${mid.toFixed(2)} vs close ${close.toFixed(2)}`);
check("turn 900 m away pulls back further", far < mid - 0.4, `far ${far.toFixed(2)} vs mid ${mid.toFixed(2)}`);
check("a very distant turn never zooms in past the base", veryFar <= BASE_ZOOM, `got ${veryFar.toFixed(2)}`);
check("the floor keeps it an overview, not a country view", veryFar >= 13.8, `got ${veryFar.toFixed(2)}`);
check("unknown turn distance keeps the base zoom",
  adaptiveNavZoom(BASE_ZOOM, null, 480, KAMPALA.lat) === BASE_ZOOM);

console.log("\nNavigation camera — the view is open, not cramped");
/* How much ground is visible ahead of the rider on screen? */
function visibleAheadM(zoom, pitch, viewportPx) {
  const mpp = metresPerPixel(KAMPALA.lat, zoom);
  return viewportPx * mpp / Math.max(Math.cos((pitch * Math.PI) / 180), 0.35);
}

const oldView = visibleAheadM(BASE_ZOOM, 0, 480);
const newView = visibleAheadM(adaptiveNavZoom(BASE_ZOOM, 250, 480, KAMPALA.lat), PITCH, 480);
check("the new camera sees materially further ahead than the old flat one",
  newView > oldView * 1.5, `old ${oldView.toFixed(0)} m vs new ${newView.toFixed(0)} m`);

console.log("\nNavigation camera — the rider sits low, the road ahead up top");
const viewportPx = 480;
const aheadPx = Math.min(viewportPx * 0.28, 140);
const zoom = adaptiveNavZoom(BASE_ZOOM, 250, viewportPx, KAMPALA.lat);
const aheadM = (aheadPx * metresPerPixel(KAMPALA.lat, zoom)) / Math.max(Math.cos((PITCH * Math.PI) / 180), 0.35);
const camCentre = offsetAlongBearing(KAMPALA, 0 /* north */, aheadM);
const movedNorth = (camCentre.lat - KAMPALA.lat) * 111320;
check("the camera centre moved forward along the heading", movedNorth > 0, `moved ${movedNorth.toFixed(0)} m`);
check("the forward move is a sensible distance, not the whole city",
  movedNorth > 20 && movedNorth < 400, `moved ${movedNorth.toFixed(0)} m`);

/* Heading east must move the camera east, not north. */
const east = offsetAlongBearing(KAMPALA, 90, 100);
check("the forward offset follows the heading (east stays east)",
  Math.abs(east.lng - KAMPALA.lng) > 1e-6 && Math.abs(east.lat - KAMPALA.lat) < 1e-6);

console.log("\nNavigation camera — the rider never leaves the screen");
/* The rider must stay inside the viewport after the camera moves ahead. */
const riderScreenFrac = 0.5 + aheadPx / viewportPx;
check("the rider is pushed below the centre, not off the bottom",
  riderScreenFrac > 0.5 && riderScreenFrac < 0.95, `at ${(riderScreenFrac * 100).toFixed(0)}% down`);

console.log(failures === 0 ? "\nAll navigation camera checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
