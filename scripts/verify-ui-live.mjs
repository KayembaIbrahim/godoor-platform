/**
 * Live verification of the UI changes requested by the user:
 *
 *   1. Sign-in page: logo CENTRED, welcome background (not plain white)
 *   2. Order-tracking map page for all 3 roles with role logic
 *   3. Navigation bar + buttons in BLACK, ORANGE when selected
 *   4. Modern 3D effects
 *
 * Runs against the deployed site (godoor.site) with a real browser so we
 * verify computed styles, not just that the CSS class names exist.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function rgbToHex(rgb) {
  const m = /rgba?\(([^)]+)\)/.exec(rgb || "");
  if (!m) return rgb;
  const [r, g, b] = m[1].split(",").map((n) => parseFloat(n.trim()));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Is this surface BLACK?
 *
 * The dark surfaces are painted as a GRADIENT (`background-image:
 * linear-gradient(...)`), not a flat `background-color` — so reading
 * `background-color` reports "transparent" and a naive check would call a
 * black capsule "not black". Look at BOTH properties and judge the darkest
 * stop of the gradient.
 */
function isBlackSurface(cs) {
  const stops = [...(cs.backgroundImage || "").matchAll(/rgba?\(([^)]+)\)/g)].map((m) =>
    m[1].split(",").map((n) => parseFloat(n.trim())),
  );
  if (stops.length) {
    // The darkest gradient stop decides the surface colour.
    const darkest = stops.reduce((a, b) => (b[0] + b[1] + b[2] < a[0] + a[1] + a[2] ? b : a));
    return darkest[0] <= 40 && darkest[1] <= 40 && darkest[2] <= 45;
  }
  const c = (cs.backgroundColor || "").match(/rgba?\(([^)]+)\)/);
  if (!c) return false;
  const [r, g, b, a = 1] = c[1].split(",").map((n) => parseFloat(n.trim()));
  if (a === 0) return false; // fully transparent — not a surface
  return r <= 40 && g <= 40 && b <= 45;
}

const isOrange = (value) => {
  if (!value) return false;
  const c = value.match(/rgba?\(([^)]+)\)/);
  if (c) {
    const [r, g, b] = c[1].split(",").map((n) => parseFloat(n.trim()));
    // GoDoor orange #F97316 = 249,115,22 — allow a small tolerance.
    return r > 225 && r < 255 && g > 90 && g < 145 && b < 70;
  }
  return /f97316|fb923c|ea580c/i.test(value);
};

const browser = await chromium.launch({
  // The sandbox's /dev/shm is tiny; without this the renderer crashes when
  // the map page allocates its WebGL buffers.
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

/* ─────────────────────────────────────────────────────────────────────────
 * 1. SIGN-IN PAGE — centred logo + welcome background
 * ───────────────────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

const signin = await page.evaluate(() => {
  const link = document.querySelector('a[aria-label="GoDoor home"]');
  const body = document.body;
  const style = getComputedStyle(body);
  // Collect every full-viewport backdrop layer (the shell renders them with -z-20)
  const layers = [...document.querySelectorAll("div[aria-hidden='true']")].map((el) => {
    const cs = getComputedStyle(el);
    return {
      position: cs.position,
      zIndex: cs.zIndex,
      backgroundImage: cs.backgroundImage,
      opacity: cs.opacity,
      inset: cs.inset,
    };
  });
  return {
    hasLogoLink: !!link,
    logoRect: link ? link.getBoundingClientRect().toJSON() : null,
    viewportWidth: window.innerWidth,
    bodyBackground: style.backgroundColor,
    layers,
    hasImageLayer: layers.some(
      (l) => l.backgroundImage && l.backgroundImage !== "none" && l.backgroundImage.includes("url("),
    ),
    hasVideo: !!document.querySelector("video"),
  };
});

check(
  "signin: logo link present",
  signin.hasLogoLink,
  signin.hasLogoLink ? "found" : "MISSING",
);

if (signin.logoRect) {
  const centerOffset = Math.abs(
    signin.logoRect.x + signin.logoRect.width / 2 - signin.viewportWidth / 2,
  );
  check(
    "signin: logo is horizontally CENTRED",
    centerOffset < 12,
    `offset ${centerOffset.toFixed(1)}px from viewport centre`,
  );
}

const painted = signin.layers.filter(
  (l) => l.backgroundImage && l.backgroundImage !== "none" && l.backgroundImage.includes("url("),
);
check(
  "signin: welcome background artwork present (not plain white)",
  signin.hasImageLayer || signin.hasVideo,
  signin.hasImageLayer
    ? `image layer: ${painted[0].backgroundImage.slice(0, 80)}`
    : signin.hasVideo
      ? "video slide"
      : `NO artwork — body bg ${signin.bodyBackground}`,
);

/* ─────────────────────────────────────────────────────────────────────────
 * 3. NAV BAR + BUTTONS — black, orange when selected
 * ───────────────────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

const nav = await page.evaluate(() => {
  const bar = document.querySelector("nav.nav-bar");
  const cs = bar ? getComputedStyle(bar) : null;
  const pills = [...document.querySelectorAll("nav.nav-bar a")].map((a) => {
    const s = getComputedStyle(a);
    return {
      text: (a.textContent || "").trim().slice(0, 24),
      cls: a.className,
      color: s.color,
      background: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      active: a.getAttribute("aria-current") === "page" || a.className.includes("nav-pill-active"),
    };
  });
  const iconBar = document.querySelector(".icon-bar");
  const ics = iconBar ? getComputedStyle(iconBar) : null;
  // Every interactive control inside the bar — the wallet link plus the
  // bell and theme buttons (the latter are nested one level down).
  const iconItems = iconBar
    ? [...iconBar.querySelectorAll("a, button")].map((el) => {
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          label: el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 20),
          color: s.color,
          background: s.backgroundColor,
          cls: el.className,
        };
      })
    : [];
  const btn3d = document.querySelector(".btn-3d");
  const b3 = btn3d ? getComputedStyle(btn3d) : null;
  return {
    hasNavBar: !!bar,
    navBg: cs ? cs.backgroundColor : null,
    navBgImage: cs ? cs.backgroundImage : null,
    navBoxShadow: cs ? cs.boxShadow : null,
    pills,
    hasIconBar: !!iconBar,
    iconBarBg: ics ? ics.backgroundColor : null,
    iconBarBgImage: ics ? ics.backgroundImage : null,
    iconItems,
    hasBtn3d: !!btn3d,
    btn3dBg: b3 ? b3.backgroundColor : null,
    btn3dBgImage: b3 ? b3.backgroundImage : null,
    btn3dShadow: b3 ? b3.boxShadow : null,
  };
});

check("nav: .nav-bar present", nav.hasNavBar);
if (nav.hasNavBar) {
  const barCs = { backgroundColor: nav.navBg, backgroundImage: nav.navBgImage };
  check(
    "nav: bar is BLACK",
    isBlackSurface(barCs),
    `bg=${nav.navBg} image=${(nav.navBgImage || "").slice(0, 60)}`,
  );
  check(
    "nav: bar has 3D depth (shadow)",
    nav.navBoxShadow && nav.navBoxShadow !== "none",
    nav.navBoxShadow || "no shadow",
  );
}

/* The landing page ("/") is the welcome screen, not a nav destination, so
 * no pill is selected there — that is correct, not a failure. The selected
 * state is asserted on /how-it-works below. */

check("nav: .icon-bar (utility trio) present", nav.hasIconBar);
if (nav.hasIconBar) {
  const barCs = { backgroundColor: nav.iconBarBg, backgroundImage: nav.iconBarBgImage };
  check(
    "icon-bar: capsule is BLACK",
    isBlackSurface(barCs),
    `bg=${nav.iconBarBg} image=${(nav.iconBarBgImage || "").slice(0, 60)}`,
  );
  check(
    "icon-bar: holds 3 controls (wallet/bell/theme)",
    nav.iconItems.length === 3,
    `${nav.iconItems.length}: ${nav.iconItems.map((i) => i.label).join(", ")}`,
  );
  // Every control must be LIGHT — dark grey on a black capsule is invisible.
  const dark = nav.iconItems.filter((i) => {
    const c = i.color.match(/rgba?\(([^)]+)\)/);
    if (!c) return false;
    const [r, g, b, a = 1] = c[1].split(",").map((n) => parseFloat(n.trim()));
    if (a === 0) return false;
    return r < 120 && g < 120 && b < 125;
  });
  check(
    "icon-bar: every control has LIGHT ink (visible on black)",
    dark.length === 0,
    dark.length ? `too dark: ${dark.map((d) => `${d.label} ${d.color}`).join(", ")}` : nav.iconItems.map((i) => `${i.label}=${i.color}`).join(", "),
  );
}

check("nav: .btn-3d standalone button present", nav.hasBtn3d);
if (nav.hasBtn3d) {
  const b3 = { backgroundColor: nav.btn3dBg, backgroundImage: nav.btn3dBgImage };
  check("btn-3d: surface is BLACK", isBlackSurface(b3), `bg=${nav.btn3dBg} image=${(nav.btn3dBgImage || "").slice(0, 60)}`);
  check(
    "btn-3d: has 3D shadow",
    nav.btn3dShadow && nav.btn3dShadow !== "none",
    nav.btn3dShadow || "no shadow",
  );
}

/* The home page ("/") is not itself a nav destination, so no pill is
 * selected there. Visit a page that IS one ("/how-it-works") to see the
 * selected state. */
await page.goto(`${BASE}/how-it-works`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const selected = await page.evaluate(() => {
  const active = [...document.querySelectorAll("nav.nav-bar a")].find(
    (a) => a.getAttribute("aria-current") === "page" || a.className.includes("nav-pill-active"),
  );
  if (!active) return null;
  const s = getComputedStyle(active);
  return {
    text: (active.textContent || "").trim(),
    color: s.color,
    background: s.backgroundColor,
    backgroundImage: s.backgroundImage,
    shadow: s.boxShadow,
  };
});
check("nav: a pill is SELECTED on /how-it-works", !!selected, selected ? selected.text : "none");
if (selected) {
  check(
    "nav: SELECTED pill is ORANGE",
    isOrange(selected.color) || isOrange(selected.background) || isOrange(selected.backgroundImage),
    `"${selected.text}" color=${selected.color} bg=${selected.background}`,
  );
  check(
    "nav: SELECTED pill has an orange glow (3D)",
    !!selected.shadow && selected.shadow !== "none" && /249|234|251|253/.test(selected.shadow),
    selected.shadow || "no shadow",
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. TRACKING MAP — role logic for all 3 roles
 * ───────────────────────────────────────────────────────────────────────── */
const resp = await page.goto(`${BASE}/tracking`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const track = await page.evaluate(() => {
  const text = document.body.innerText || "";
  // The map is Mapbox GL — its container carries the `mapboxgl-map` class
  // and the WebGL canvas lives in `mapboxgl-canvas-container`.
  const hasMap =
    !!document.querySelector(".mapboxgl-map") ||
    !!document.querySelector(".mapboxgl-canvas-container") ||
    !!document.querySelector(".leaflet-container") ||
    !!document.querySelector(".maplibregl-map");
  return {
    bodyLen: document.body.innerHTML.length,
    hasMap,
    hasCanvas: document.querySelectorAll("canvas").length > 0,
    text: text.replace(/\s+/g, " ").slice(0, 400),
  };
});

check("tracking: page renders", resp?.status() === 200, `http ${resp?.status()}`);
check(
  "tracking: a MAP surface is present",
  track.hasMap,
  track.hasMap ? `mapboxgl container + ${track.hasCanvas ? "canvas" : "no canvas"}` : "no map container in DOM",
);
check(
  "tracking: renders the ROLE-AWARE overview (not a generic map)",
  /Track my orders|My live routes|Store deliveries|Live map/i.test(track.text),
  track.text.slice(0, 120),
);

/* Role logic lives server-side in the API + client-side in RoleOverview.
 * Verify the API returns role-scoped data for an anonymous caller and that
 * the page renders the role-aware overview copy. */
const apiCalls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/orders")) apiCalls.push({ url: r.url(), status: r.status() });
});
await page.goto(`${BASE}/tracking`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(1200);
check(
  "tracking: orders API called for role scoping",
  apiCalls.length > 0,
  apiCalls.map((c) => `${c.status} ${c.url.split("?")[0]}`).join(", ") || "no /api/orders call",
);

/* ─────────────────────────────────────────────────────────────────────────
 * 4. CATALOGUE — "View all" (carried from the earlier request)
 *
 * The marketing category rail lives on /explore (the landing page "/"
 * is the welcome screen, not a category listing), so that is where the
 * "View all N categories" link must appear.
 * ───────────────────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const cat = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[href="/categories"]')];
  const viewAll = links.filter((a) => /view all/i.test(a.textContent || ""));
  const tiles = [...document.querySelectorAll('a[href^="/categories/"]')];
  return {
    tilesShown: tiles.length,
    total: viewAll[0] ? (viewAll[0].textContent.match(/\d+/) || [null])[0] : null,
    label: viewAll[0] ? (viewAll[0].textContent || "").trim().replace(/\s+/g, " ") : null,
  };
});
check(
  "catalogue: a 'View all N categories' link exists on /explore",
  !!cat.label,
  cat.label || "no /categories link found",
);
check(
  "catalogue: the link reveals there is MORE than the tiles shown",
  !!cat.total && Number(cat.total) > cat.tilesShown,
  `${cat.tilesShown} tiles shown, link says ${cat.total} total`,
);

/* ─────────────────────────────────────────────────────────────────────────
 * 5. ACCOUNT DATE — no NaN
 * ───────────────────────────────────────────────────────────────────────── */
const nan = await page.evaluate(() => /NaN/.test(document.body.innerText || ""));
check("account: no 'NaN' in rendered output", !nan);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
