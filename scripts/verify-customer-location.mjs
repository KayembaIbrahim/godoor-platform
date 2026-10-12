/**
 * Customer home location resolution.
 *
 * The defect: the header showed a district the customer was never in, because
 * `"idle"` — the PRE-detection state — was treated as a detection failure and
 * substituted a hard-coded city coordinate, which was then reverse-geocoded and
 * displayed. Detection was running correctly the whole time; the UI was naming a
 * guess. That is what made the home screen look like it forced a manual search
 * while the welcome page, which has no such branch, appeared to work.
 *
 * Runs the real `customer-location-core` — not a copy.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd()}/scripts/`));

const { resolveEffectiveLoc, resolveDisplayAddress, isDetecting, isDeliberate } = await import(
  "../src/lib/customer-location-core.ts"
);

const MASAKA = { lat: -0.3384, lng: 32.6344 };
const MASAKA_POINT = { lat: -0.3376, lng: 32.6336 };

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`); }
};

const loc = (o) => resolveEffectiveLoc(o, MASAKA);
const disp = (o) => resolveDisplayAddress(o);

console.log("\ncustomer home location\n");

// ── The regression itself ──────────────────────────────────────────────────
console.log("  ── the phantom-district bug ──");
check("pre-detection does NOT substitute the fallback",
  loc({ saved: null, gpsLoc: null, status: "idle" }), { loc: null, isFallback: false });
check("detecting does NOT substitute the fallback",
  loc({ saved: null, gpsLoc: null, status: "locating" }), { loc: null, isFallback: false });
check("only a definite failure substitutes the fallback",
  loc({ saved: null, gpsLoc: null, status: "denied" }), { loc: MASAKA, isFallback: true });
check("the fallback is the launch city, not Kampala",
  loc({ saved: null, gpsLoc: null, status: "denied" }).loc.lat < 0, true);

// ── Precedence ─────────────────────────────────────────────────────────────
console.log("\n  ── precedence ──");
check("a deliberate address beats GPS",
  loc({ saved: { place: "Bwala Hill", ...MASAKA_POINT }, gpsLoc: null, status: "watching" }),
  { loc: MASAKA_POINT, isFallback: false });
check("a real fix beats the fallback",
  loc({ saved: null, gpsLoc: MASAKA_POINT, status: "denied" }),
  { loc: MASAKA_POINT, isFallback: false });
check("a real fix is never marked as a fallback",
  loc({ saved: null, gpsLoc: MASAKA_POINT, status: "watching" }).isFallback, false);

// ── Display ────────────────────────────────────────────────────────────────
console.log("\n  ── display ──");
check("first paint says it is detecting, not 'set address'",
  disp({ saved: null, gpsPlace: null, gpsLoc: null, detectedDistrict: null, status: "idle" }),
  "Detecting your location…");
check("never the manual prompt while detecting",
  ["idle", "locating"].map((status) =>
    disp({ saved: null, gpsPlace: null, gpsLoc: null, detectedDistrict: null, status })),
  ["Detecting your location…", "Detecting your location…"]);
check("a real place name wins",
  disp({ saved: null, gpsPlace: "Bwala Hill, Kitabaazi", gpsLoc: MASAKA_POINT, detectedDistrict: "Masaka", status: "watching" }),
  "Bwala Hill, Kitabaazi");
check("a saved address wins over everything",
  disp({ saved: { place: "Nakasero", ...MASAKA_POINT }, gpsPlace: "Bwala Hill", gpsLoc: MASAKA_POINT, detectedDistrict: "Masaka", status: "watching" }),
  "Nakasero");
check("position without a street name is stated honestly",
  disp({ saved: null, gpsPlace: null, gpsLoc: MASAKA_POINT, detectedDistrict: null, status: "watching" }),
  "Using your current location");
check("a district from a REAL fix is shown",
  disp({ saved: null, gpsPlace: null, gpsLoc: MASAKA_POINT, detectedDistrict: "Masaka", status: "watching" }),
  "Near Masaka");
check("a district never appears without a measured position",
  disp({ saved: null, gpsPlace: null, gpsLoc: null, detectedDistrict: "Kampala", status: "idle" }),
  "Detecting your location…");
check("the manual prompt appears only after a definite failure",
  disp({ saved: null, gpsPlace: null, gpsLoc: null, detectedDistrict: null, status: "denied" }),
  "Set delivery address");

// ── The welcome page's outcome, reproduced ────────────────────────────────
console.log("\n  ── the sequence a customer actually sees ──");
const seq = [];
for (const status of ["idle", "locating", "watching"]) {
  seq.push(disp({
    saved: null,
    gpsPlace: status === "watching" ? "Bwala Hill, Kitabaazi" : null,
    gpsLoc: status === "watching" ? MASAKA_POINT : null,
    detectedDistrict: null,
    status,
  }));
}
check("idle → locating → real address, never a wrong district",
  seq, ["Detecting your location…", "Detecting your location…", "Bwala Hill, Kitabaazi"]);

// ── isDetecting ────────────────────────────────────────────────────────────
console.log("\n  ── isDetecting ──");
check("idle and locating are detecting; the rest are not",
  ["idle", "locating", "ok", "denied", "watching"].map(isDetecting),
  [true, true, false, false, false]);

// ── Stale stored address vs a live fix ─────────────────────────────────────
//
// The second defect, and the one the customer actually reports: both surfaces
// persist into one localStorage key, and the home screen ranked that stored
// value ABOVE the live reading. So the first address ever written — an
// IP-level city estimate, or a place picked on last week's WiFi — outranked
// GPS forever, because `rememberDetectedAddress` refused to overwrite an
// existing entry and nothing else ever wrote it. The header showed a stale
// place while the real one sat unused in the hook, and re-picking by hand was
// the only way forward. The welcome page never hit this because it displays
// the live reading directly and never reads storage.
console.log("\n  ── a stored address must not outrank a live fix ──");
const STALE = { place: "Kampala", lat: 0.3163, lng: 32.5822 };
const AUTO = { ...STALE, source: "auto" };
const MANUAL = { place: "Bwala Hill", ...MASAKA_POINT, source: "manual" };

check("a machine-detected address yields to a live fix (THE BUG)",
  loc({ saved: AUTO, gpsLoc: MASAKA_POINT, status: "watching" }),
  { loc: MASAKA_POINT, isFallback: false });
check("...and the header shows the live place, not the stale one",
  disp({ saved: AUTO, gpsPlace: "Bwala Hill, Kitabaazi", gpsLoc: MASAKA_POINT,
         detectedDistrict: "Masaka", status: "watching" }),
  "Bwala Hill, Kitabaazi");
check("a deliberate choice still beats a live fix",
  loc({ saved: MANUAL, gpsLoc: STALE, status: "watching" }),
  { loc: MASAKA_POINT, isFallback: false });
check("...and still wins the header line",
  disp({ saved: MANUAL, gpsPlace: "Somewhere Else", gpsLoc: MASAKA_POINT,
         detectedDistrict: null, status: "watching" }),
  "Bwala Hill");
check("with no live fix, a detected address is still shown",
  disp({ saved: AUTO, gpsPlace: null, gpsLoc: null, detectedDistrict: null, status: "watching" }),
  "Kampala");
check("with no live fix, a detected address still drives the catalogue",
  loc({ saved: AUTO, gpsLoc: null, status: "watching" }),
  { loc: { lat: STALE.lat, lng: STALE.lng }, isFallback: false });
check("a live district beats a detected address when there is no street name",
  disp({ saved: AUTO, gpsPlace: null, gpsLoc: MASAKA_POINT,
         detectedDistrict: "Masaka", status: "watching" }),
  "Near Masaka");

// ── Legacy records carry no `source` ────────────────────────────────────────
console.log("\n  ── legacy records (no source marker) ──");
check("an unmarked record counts as deliberate, so a pick is never moved",
  isDeliberate({ place: "Bwala Hill", ...MASAKA_POINT }), true);
check("an explicit auto record does not",
  isDeliberate(AUTO), false);
check("an explicit manual record does",
  isDeliberate(MANUAL), true);
check("nothing stored is not deliberate",
  isDeliberate(null), false);
check("a legacy pick is not displaced by a live fix",
  loc({ saved: { place: "Bwala Hill", ...MASAKA_POINT }, gpsLoc: STALE, status: "watching" }),
  { loc: MASAKA_POINT, isFallback: false });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
