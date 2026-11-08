/**
 * Regression test for the Uganda gazetteer.
 *
 * Run with:  npx tsx tools/qa/uganda-places.test.ts
 *
 * The bug this guards against: place naming depended entirely on two remote
 * geocoders, so a typed place could return an empty list and a GPS point
 * could be labelled with a neighbouring district. The gazetteer makes both
 * work offline, and this test pins that behaviour.
 */
import {
  DISTRICTS,
  TOWNS,
  searchUgandaPlaces,
  nearestUgandaPlace,
  nearestSubPlace,
  districtForPoint,
  gazetteerPlaceName,
  placeLabel,
} from "@/lib/uganda-places";
import { MASAKA, normalizePlaceName } from "@/lib/location";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label} → ${JSON.stringify(actual)}`);
  }
}

console.log("\n── coverage ──");
check("district count is at least 120", DISTRICTS.length >= 120, true);
check("town/neighbourhood count is at least 60", TOWNS.length >= 60, true);
const dupes = DISTRICTS.map((d) => d.name).filter((n, i, a) => a.indexOf(n) !== i);
check("no duplicate district names", dupes, []);

// Every coordinate must be inside Uganda's bounding box.
const inUganda = (la: number, lo: number) => la >= -1.6 && la <= 4.3 && lo >= 29.3 && lo <= 35.1;
const outside = [...DISTRICTS, ...TOWNS].filter((p) => !inUganda(p.lat, p.lng)).map((p) => p.name);
check("every coordinate is inside Uganda", outside, []);

console.log("\n── typed search finds the place ──");
for (const q of [
  "Kampala",
  "kampala",
  "KAMPALA",
  "  kampala  ",
  "Masaka",
  "fort portal",
  "Fort-Portal",
  "Nansana",
  "Kawempe",
  "Ntinda",
  "Gulu",
  "Mbarara",
  "Buhweju",
  "Kazo",
  "Kyenjojo",
  "Kabale",
  "Buvuma",
]) {
  const hits = searchUgandaPlaces(q);
  check(`"${q}" returns at least one place`, hits.length > 0, true);
}

console.log("\n── the best match is the right one ──");
const best = (q: string) => searchUgandaPlaces(q)[0]?.name;
check('"kamp" → Kampala', best("kamp"), "Kampala");
check('"fort portal" → Fort Portal', best("fort portal"), "Fort Portal");
check('"nansana" → Nansana', best("nansana"), "Nansana");
check('"masak" → Masaka', best("masak"), "Masaka");
check('"ntind" → Ntinda', best("ntind"), "Ntinda");
check('"mbarar" → Mbarara', best("mbarar"), "Mbarara");
check('"kawemp" → Kawempe', best("kawemp"), "Kawempe");

console.log("\n── a GPS point is named, not numbered ──");
// Masaka city — the launch city. These are the coordinates the `MASAKA`
// fallback constant uses; the constant itself was 100km east of the real
// town until this test existed.
check("Masaka city point → Masaka", districtForPoint({ lat: -0.3417, lng: 31.7344 }), "Masaka");
// Kampala.
check("Kampala point → Kampala", districtForPoint({ lat: 0.3163, lng: 32.5822 }), "Kampala");
// A district that the OLD 67-entry list did not contain at all.
check("Buhweju point → Buhweju", districtForPoint({ lat: -0.7333, lng: 30.0333 }), "Buhweju");
check("Rwaki point → Rwaki", districtForPoint({ lat: -0.6833, lng: 29.9833 }), "Rwaki");
check("Kazo point → Kazo", districtForPoint({ lat: -1.1333, lng: 32.9 }), "Kazo");
check("Kikuube point → Kikuube", districtForPoint({ lat: 1.5, lng: 31.5 }), "Kikuube");
// A Kampala neighbourhood should name the neighbourhood AND the district.
check(
  "Kawempe point names the neighbourhood",
  gazetteerPlaceName({ lat: 0.3589, lng: 32.6417 }),
  "Kawempe, Kampala",
);

console.log("\n── parts of Masaka are named by area, not just 'Masaka' ──");
/* BUG (user report): "am in different part of masaka but the auto
   location shows me masaka only". The old gazetteer fallback used
   `nearestUgandaPlace`, which includes the DISTRICT row (one point at the
   Masaka town centre). Anyone standing in Nyendo / Kyabakuza / Bukakata /
   Kisijjo was still closest to that centre, so every part of the district
   produced the bare name "Masaka". These points would have all failed
   before the fix: they are 5-15 km from the Masaka town centre and had no
   sub-place within range. */
for (const [label, point, expected] of [
  ["Nyendo point → 'Nyendo, Masaka'", { lat: -0.3250, lng: 31.6600 }, "Nyendo, Masaka"],
  ["Kyabakuza point → 'Kyabakuza, Masaka'", { lat: -0.3400, lng: 31.7800 }, "Kyabakuza, Masaka"],
  ["Bukakata point → 'Bukakata, Masaka'", { lat: -0.4300, lng: 31.7600 }, "Bukakata, Masaka"],
  ["Kisijjo point → 'Kisijjo, Masaka'", { lat: -0.3150, lng: 31.8000 }, "Kisijjo, Masaka"],
  ["Masaka Town centre → sub-area, not bare district", { lat: -0.3356, lng: 31.7341 }, "Masaka Town, Masaka"],
] as const) {
  const actual = gazetteerPlaceName(point as { lat: number; lng: number });
  check(label, actual, expected);
  check(
    `${label} — never collapses to the bare district name`,
    actual === "Masaka",
    false,
  );
}
// nearestSubPlace must exclude district rows entirely.
check(
  "nearestSubPlace at Nyendo is Nyendo (not the Masaka district row)",
  nearestSubPlace({ lat: -0.3250, lng: 31.6600 }, 20)?.place.name,
  "Nyendo",
);
check(
  "nearestSubPlace far outside any sub-area is null",
  nearestSubPlace({ lat: 0.0, lng: 34.9 }, 20),
  null,
);
// districtForPoint is still the correct source for the district name.
for (const [label, point] of [
  ["Nyendo point district → Masaka", { lat: -0.3250, lng: 31.6600 }],
  ["Bukakata point district → Masaka", { lat: -0.4300, lng: 31.7600 }],
] as const) {
  check(label, districtForPoint(point as { lat: number; lng: number }), "Masaka");
}

console.log("\n── no raw coordinates for a place we know ──");
const near = nearestUgandaPlace({ lat: 0.3589, lng: 32.6417 });
check("nearest place to Kawempe is Kawempe", near?.place.name, "Kawempe");

console.log("\n── a one-letter query does not dump the country ──");
check('"a" returns nothing', searchUgandaPlaces("a").length, 0);
check('"ab" returns few', searchUgandaPlaces("ab").length <= 5, true);

console.log("\n── the launch-city fallback agrees with the gazetteer ──");
/* The `MASAKA` constant is the position used to sort the catalogue when GPS
   is denied. It was 100km east of the real town (longitude 32.6344 instead of
   31.7344), so a Masaka customer with location off was measured from the
   middle of nowhere and every shop read as "far away". This check pins the
   constant to the gazetteer so it cannot drift again. */
const masakaConst = MASAKA;
const masakaPlace = DISTRICTS.find((d) => d.name === "Masaka");
check("MASAKA is in the gazetteer", !!masakaPlace, true);
if (masakaPlace) {
  const km =
    Math.hypot(
      (masakaPlace.lat - masakaConst.lat) * 110.57,
      (masakaPlace.lng - masakaConst.lng) * 111.32 * Math.cos((-0.34 * Math.PI) / 180),
    );
  check("MASAKA is within 5km of the gazetteer's Masaka", km < 5, true);
}

console.log("\n── place labels are human readable ──");
for (const p of TOWNS) {
  // A town is labelled with the district it belongs to, and never with a
  // second copy of its own name.
  const label = placeLabel(p);
  const parts = label.split(", ").map((s) => s.toLowerCase());
  check(`town "${p.name}" → "${label}"`, parts[0] !== parts[1], true);
}
for (const d of DISTRICTS) {
  check(`district "${d.name}" → "${d.name}"`, placeLabel(d) === d.name, true);
}

console.log("\n── duplicate first fragments collapse ──");
for (const name of [
  "Buhweju, Buhweju, Uganda",
  "Kampala, Kampala, Kampala",
  "Kazo, Kazo, Western Region",
]) {
  const out = normalizePlaceName(name);
  const parts = out.split(", ").map((s) => s.toLowerCase());
  check(`"${name}" → "${out}"`, parts[0] !== parts[1], true);
}
check('"Nansana, Wakiso" survives unchanged', normalizePlaceName("Nansana, Wakiso"), "Nansana, Wakiso");
check('"Fort Portal" survives unchanged', normalizePlaceName("Fort Portal"), "Fort Portal");

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
