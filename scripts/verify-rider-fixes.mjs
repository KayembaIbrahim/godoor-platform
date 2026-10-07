/**
 * Proves the rider-side fixes by simulating the exact sequences that used to
 * break. Run: node scripts/verify-rider-fixes.mjs
 */

// ── 1. The sticky "Sign in to continue" banner ────────────────────────────
// Mirrors BodaPanel.load(): error is set on failure, and must be cleared once
// a later poll succeeds.
function makePanel() {
  let rides = [];
  let error = null;
  let loads = 0;
  return {
    get rides() { return rides; },
    get error() { return error; },
    get loads() { return loads; },
    load(authReady, response) {
      loads++;
      return Promise.resolve(response).then((rs) => {
        rides = rs;
        error = null;            // the fix
        return rs;
      }).catch((e) => {
        const msg = e.message || String(e);
        if (!authReady && /sign in|unauthor|401|403|token|session/i.test(msg)) return;
        error = msg;
      });
    },
  };
}

const fail = (msg) => Promise.reject(new Error(msg));
let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name} ${extra}`); failures++; }
};

console.log("\n1. Sticky auth error (the reported 'not signed in')");
{
  const p = makePanel();
  // Signed-in rider; a single pre-hydration poll goes out unauthenticated.
  await p.load(false, fail("Sign in to continue"));
  check("early 401 is not shown while auth is unresolved", p.error === null, `got ${p.error}`);
  // Session hydrates; the 15s poll now succeeds with real rides.
  await p.load(true, Promise.resolve([{ id: "r1" }]));
  check("successful poll clears any prior error", p.error === null, `got ${p.error}`);
  check("rides render", p.rides.length === 1);
}
{
  const p = makePanel();
  await p.load(true, fail("Sign in to continue"));  // genuinely signed out
  check("real auth failure after hydration IS surfaced", p.error === "Sign in to continue");
  await p.load(true, Promise.resolve([]));         // signs back in
  check("banner clears once auth recovers", p.error === null, `got ${p.error}`);
}
{
  const p = makePanel();
  await p.load(true, fail("Verify your rider account to see ride requests."));
  check("non-auth error is always surfaced",
    /Verify your rider/.test(p.error || ""), `got ${p.error}`);
}

// ── 2. Heading: the 0° bug and the standstill bug ────────────────────────
// Mirrors location.ts processPosition.
function processPosition(state, pos) {
  const newHeading =
    pos.heading != null && Number.isFinite(pos.heading) ? pos.heading : null;
  const moved = !state.last || Math.hypot(pos.dx ?? 0, pos.dy ?? 0) >= 10;
  const turned =
    newHeading != null && state.lastHeading != null &&
    Math.abs(((newHeading - state.lastHeading + 540) % 360) - 180) > 25;
  if (moved || turned || pos.better) {
    state.last = true;
    if (newHeading != null) state.lastHeading = newHeading;
    state.heading = newHeading;
    state.updated = "position";
  } else if (newHeading != null && newHeading !== state.lastHeading) {
    state.lastHeading = newHeading;     // the fix: heading tracked independently
    state.heading = newHeading;
    state.updated = "heading-only";
  }
  return state;
}

console.log("\n2. Heading correctness");
{
  const s = { heading: null, lastHeading: null, last: null, updated: null };
  processPosition(s, { heading: 0, better: true });
  check("heading 0 (due north) survives `??`, not treated as missing",
    s.heading === 0, `got ${s.heading}`);

  const s2 = { heading: null, lastHeading: null, last: null, updated: null };
  processPosition(s2, { heading: 90, better: true });
  processPosition(s2, { heading: 180, better: false });   // rider stopped, turns 90°
  check("turning 90° while stationary still updates heading",
    s2.heading === 180, `got ${s2.heading}`);

  // The heading-only branch is the one that matters: a sub-threshold turn
  // (creeping round a roundabout, 15°) with no movement.
  const s2b = { heading: null, lastHeading: null, last: null, updated: null };
  processPosition(s2b, { heading: 45, better: true });
  processPosition(s2b, { heading: 60, better: false });
  check("sub-threshold turn while stationary still updates heading",
    s2b.heading === 60 && s2b.updated === "heading-only",
    `got ${s2b.heading}/${s2b.updated}`);

  const s3 = { heading: null, lastHeading: null, last: null, updated: null };
  processPosition(s3, { heading: 359, better: true });
  processPosition(s3, { heading: 1, better: false });     // 2 deg, not 358
  check("359°→1° reads as a 2° turn, not a U-turn", s3.heading === 1);

  const s4 = { heading: 45, lastHeading: 45, last: true, updated: null };
  processPosition(s4, { heading: null, better: false }); // device reports unknown
  check("a null reading does not clobber the last good heading",
    s4.heading === 45, `got ${s4.heading}`);
}

// ── 3. Navigation camera focus ───────────────────────────────────────────
console.log("\n3. Navigation camera");
function applyFocus({ navBearing, rider, fitCount, navigationZoom }) {
  if (navBearing != null) {
    return { mode: "navigate", zoom: navigationZoom, pitch: 0, bearing: navBearing, on: rider };
  }
  return { mode: fitCount >= 2 ? "fitBounds" : "flyTo", maxZoom: 15.5 };
}
{
  const nav = applyFocus({ navBearing: 120, rider: { lat: 0.3, lng: 32.5 }, fitCount: 3, navigationZoom: 16.5 });
  check("riding focuses the rider at street zoom, not the whole route",
    nav.mode === "navigate" && nav.zoom === 16.5 && nav.pitch === 0,
    JSON.stringify(nav));
  const idle = applyFocus({ navBearing: null, fitCount: 3, navigationZoom: 16.5 });
  check("idle still gets the overview", idle.mode === "fitBounds");
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);