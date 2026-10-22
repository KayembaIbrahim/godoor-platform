/**
 * VEHICLE MARKS — the silhouettes that identify WHO is on the map.
 *
 * WHY THIS EXISTS
 * ---------------
 * The rider used to be drawn as a plain rectangle with two circles under it
 * and a triangle on top. Read at map scale, that is a cart, a shopping trolley
 * and a kite — not a motorbike. A customer watching a delivery could not tell
 * a motorcycle from a car, and neither looked like the apps people already
 * trust (Uber, SafeBoda, Glovo). Those apps put a real vehicle silhouette in
 * a raised tile, and that is what makes them legible at a glance.
 *
 * So this module draws the vehicle, top-down, with a shaded body that reads as
 * a physical object sitting on the map rather than a flat icon pasted onto it.
 *
 * THE GEOMETRY
 * ------------
 * Every silhouette is drawn pointing UP (north) inside a 48x48 box centred on
 * (24, 24). The marker rotates the whole glyph by the rider's heading, so
 * "north" is the vehicle's forward direction. Top-down is the only projection
 * that can be rotated by a heading without looking wrong — a side view
 * spinning around its own axis reads as a coin flipping, not a vehicle
 * turning.
 *
 * THE SHADING
 * -----------
 * Three tones do the work of three dimensions:
 *   • a vertical gradient on the body (light at the nose, dark at the tail),
 *     which reads as a curved surface catching overhead light;
 *   • a near-black underside on the wheels, so they sit BELOW the body;
 *   • a soft ellipse on the ground, offset toward the tail, which plants the
 *     vehicle on the map instead of letting it float.
 *
 * The accent colour is a parameter. The rider tile is brand orange; a car
 * rides in the same orange so the family still reads as one system, but a
 * different vehicle is instantly distinguishable by silhouette alone.
 */

/** The vehicle kinds a GoDoor provider can be on the road with. */
export type VehicleKind = "motorbike" | "car" | "bicycle" | "van" | "walking";

/**
 * Map whatever the database stores onto a silhouette.
 *
 * The riders table stores a free-text `vehicle_type` that operators type
 * themselves, so it is not a controlled vocabulary: "motorbike", "Motor Bike",
 * "motorcycle", "boda" and "moto" all mean the same vehicle. Anything we do
 * not recognise falls back to the motorbike, because that is the default the
 * whole app is built around and it is by far the most common.
 */
export function vehicleKind(type?: string | null): VehicleKind {
  const t = (type || "").toLowerCase().trim();
  if (!t) return "motorbike";

  /* ORDER MATTERS — these are checked most-specific first.
     "motorcycle" contains "cycle" and "e-bike" contains "bike", so a bicycle
     rule that runs before the motorbike rule swallows both of them and a
     motorbike ends up drawn as a bicycle. Terms that can be a substring of
     another term's word must therefore be checked last.
     The rule of thumb used here: match on whole words where the word can be
     embedded in a longer one, and use a negative lookbehind where it cannot. */

  /* "on foot", "foot", "walking", "walker" — a courier travelling on foot. */
  if (/\b(foot|feet|walk|walker|walking|pedestrian|runner)\b/.test(t)) return "walking";

  /* Vans and lorries. "van" also appears in "vanguard"/"advantage", so the
     word boundary is load-bearing here. */
  if (/\b(van|vans|truck|trucks|pickup|pick-up|lorry|trailer|baggage|cargo)\b/.test(t)) return "van";

  /* Cars. "car" appears in "cargo" (handled above) and "caravan", hence the
     boundary. */
  if (/\b(car|cars|suv|suvs|taxi|taxis|jeep|saloon|sedan|minivan|hatchback)\b/.test(t)) return "car";

  /* Bicycles. Deliberately EXCLUDES "motorcycle", which contains "cycle" —
     that word is a motorbike and is matched below. */
  if (/\b(bicycle|bicycles|cycle|cycles|mtb|pedal)\b/.test(t) && !/motor/.test(t)) return "bicycle";

  /* Motorbikes. Checked last among the vehicles because "motorcycle" and
     "e-bike" both contain shorter words that would otherwise match first. */
  if (/(motor|moto|boda|bike|bikes|mbike|mtb|motorcycle|motor-bike)/.test(t)) return "motorbike";

  /* Anything unrecognised: the motorbike is the app's default and by far the
     most common vehicle on the road here, so an unknown value should still
     look like the fleet rather than like nothing at all. */
  return "motorbike";
}

/* ── the accent ramp ─────────────────────────────────────────────────────
   Each silhouette needs three stops: the highlight on the upper surface, the
   mid tone, and the shadowed lower edge. The ramp is shared by every
   vehicle so they look like one family. */
function bodyGradient(id: string, from: string, to: string): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="52%" stop-color="${to}"/>
      <stop offset="100%" stop-color="${to}" stop-opacity="0.82"/>
    </linearGradient>`;
}

/** A wheel: black tyre, lighter rim, small hub. Drawn under the body. */
function wheel(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#15151a"/>
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.46).toFixed(2)}" fill="#57575f"/>
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.18).toFixed(2)}" fill="#a1a1aa"/>`;
}

/**
 * The soft ground shadow that plants the vehicle on the map.
 *
 * It is deliberately CENTRED and radially symmetric. The marker rotates the
 * whole glyph by the rider's heading, so an off-centre shadow would swing
 * around the pin as the rider turned and read as the vehicle sliding
 * sideways. A centred contact shadow is heading-invariant and does what a
 * shadow under a top-down object actually does: darken the road beneath it.
 */
function groundShadow(): string {
  return `<ellipse cx="24" cy="24" rx="15" ry="15" fill="url(#gdrShadow)"/>`;
}

/* ── MOTORBIKE ───────────────────────────────────────────────────────────
   Top-down motorbike with the rider on it. The two wheels are the longest
   thing in the silhouette, which is what makes it read as a bike and not a
   generic blob; the white helmet between them is the second cue. */
function motorbike(): string {
  return `
    ${groundShadow()}
    ${wheel(24, 11.5, 5.6)}
    ${wheel(24, 33.5, 6.2)}
    <!-- handlebars -->
    <rect x="15.4" y="15.4" width="17.2" height="2.4" rx="1.2" fill="#3f3f46"/>
    <!-- fairing / tank -->
    <path d="M18.6 32.4 V21.2 q0-4.6 5.4-4.6 t5.4 4.6 V32.4 Z" fill="url(#gdrBody)"/>
    <path d="M18.6 32.4 V21.2 q0-4.6 5.4-4.6 t5.4 4.6 V32.4 Z" fill="url(#gdrSheen)"/>
    <!-- rider: shoulders then helmet -->
    <path d="M19.2 24.8 q4.8-3.4 9.6 0 v3.4 h-9.6 Z" fill="#f4f4f5"/>
    <circle cx="24" cy="19.4" r="4.5" fill="#ffffff"/>
    <path d="M20.1 19.2 a3.9 3.9 0 0 1 7.8 0 v1.5 h-7.8 Z" fill="#1f2937"/>`;
}

/* ── CAR ─────────────────────────────────────────────────────────────────
   A saloon seen from above: wide body, dark glasshouse, four wheels peeking
   out at the corners. The glasshouse is what separates it from the van at
   map scale — a car has a distinct bonnet and boot, a van is one long box. */
function car(): string {
  return `
    ${groundShadow()}
    ${wheel(11.6, 13, 3.5)}
    ${wheel(36.4, 13, 3.5)}
    ${wheel(11.6, 33, 3.5)}
    ${wheel(36.4, 33, 3.5)}
    <!-- body -->
    <rect x="12.6" y="4" width="22.8" height="40" rx="7.2" fill="url(#gdrBody)"/>
    <rect x="12.6" y="4" width="22.8" height="40" rx="7.2" fill="url(#gdrSheen)"/>
    <!-- glasshouse -->
    <path d="M16.4 13 q0-2.4 2.6-2.4 h6 q2.6 0 2.6 2.4 v4.2 h-11.2 Z" fill="#1f2937"/>
    <path d="M16.4 30.4 h11.2 v4 q0 2.6-2.6 2.6 h-6 q-2.6 0-2.6-2.6 Z" fill="#1f2937"/>
    <!-- roof highlight -->
    <rect x="16.2" y="19.4" width="15.6" height="9.2" rx="2.6" fill="#ffffff" opacity="0.18"/>`;
}

/* ── BICYCLE ─────────────────────────────────────────────────────────────
   Leaner than the motorbike: thinner wheels, no fairing, straight bars. */
function bicycle(): string {
  return `
    ${groundShadow()}
    ${wheel(24, 12, 4.6)}
    ${wheel(24, 33, 5)}
    <rect x="17" y="16" width="14" height="1.9" rx="0.95" fill="#3f3f46"/>
    <path d="M20.6 30.6 V19.4 h6.8 v11.2 Z" fill="url(#gdrBody)"/>
    <path d="M20.6 30.6 V19.4 h6.8 v11.2 Z" fill="url(#gdrSheen)"/>
    <circle cx="24" cy="22.6" r="3.9" fill="#ffffff"/>
    <path d="M20.6 22.5 a3.4 3.4 0 0 1 6.8 0 v1.2 h-6.8 Z" fill="#1f2937"/>`;
}

/* ── VAN ─────────────────────────────────────────────────────────────────
   One long box with a short bonnet — the delivery-van silhouette. */
function van(): string {
  return `
    ${groundShadow()}
    ${wheel(11.8, 15, 3.4)}
    ${wheel(36.2, 15, 3.4)}
    ${wheel(11.8, 34, 3.4)}
    ${wheel(36.2, 34, 3.4)}
    <rect x="12.4" y="4.5" width="23.2" height="39" rx="4.6" fill="url(#gdrBody)"/>
    <rect x="12.4" y="4.5" width="23.2" height="39" rx="4.6" fill="url(#gdrSheen)"/>
    <!-- cab glass at the nose -->
    <path d="M16.6 9.4 q0-2 2.2-2 h6.4 q2.2 0 2.2 2 v4.4 h-10.8 Z" fill="#1f2937"/>
    <!-- cargo seam -->
    <rect x="16.2" y="18.4" width="15.6" height="1.5" rx="0.75" fill="#000" opacity="0.18"/>
    <rect x="16.2" y="30.4" width="15.6" height="1.5" rx="0.75" fill="#000" opacity="0.18"/>`;
}

/* ── ON FOOT ─────────────────────────────────────────────────────────────
   A courier on foot: shoulders and head, seen from above. */
function walking(): string {
  return `
    ${groundShadow()}
    <path d="M24 33.6 c-7 0-9.6-5.4-9.6-10.6 0-4.6 4.2-7.4 9.6-7.4 s9.6 2.8 9.6 7.4 c0 5.2-2.6 10.6-9.6 10.6 Z" fill="url(#gdrBody)"/>
    <path d="M24 33.6 c-7 0-9.6-5.4-9.6-10.6 0-4.6 4.2-7.4 9.6-7.4 s9.6 2.8 9.6 7.4 c0 5.2-2.6 10.6-9.6 10.6 Z" fill="url(#gdrSheen)"/>
    <circle cx="24" cy="16.4" r="5.6" fill="#ffffff"/>
    <path d="M18.4 16.2 a5.6 5.6 0 0 1 11.2 0 v2 h-11.2 Z" fill="#1f2937"/>`;
}

/**
 * Build the SVG for a vehicle marker.
 *
 * @param type     the raw `vehicle_type` from the database
 * @param size     the rendered box size in px
 * @param from     the highlight colour of the body
 * @param to       the shadow colour of the body
 * @param uid      a unique suffix so several markers on one map do not
 *                 share (and therefore clash on) the same gradient ids
 */
export function vehicleSvg(opts: {
  type?: string | null;
  size?: number;
  from?: string;
  to?: string;
  uid: string;
}): string {
  const size = opts.size ?? 48;
  const from = opts.from ?? "#FDBA74";
  const to = opts.to ?? "#EA580C";
  const kind = vehicleKind(opts.type);

  const gid = `gdrBody${opts.uid}`;
  const sid = `gdrSheen${opts.uid}`;

  let art: string;
  switch (kind) {
    case "car": art = car(); break;
    case "bicycle": art = bicycle(); break;
    case "van": art = van(); break;
    case "walking": art = walking(); break;
    default: art = motorbike(); break;
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" style="display:block">
    <defs>
      ${bodyGradient(gid, from, to)}
      <radialGradient id="gdrShadow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.34"/>
        <stop offset="62%" stop-color="#000000" stop-opacity="0.20"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${sid}" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
        <stop offset="45%" stop-color="#ffffff" stop-opacity="0.06"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    ${art}
  </svg>`;
}
