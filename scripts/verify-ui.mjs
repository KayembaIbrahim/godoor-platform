import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3111";
let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

/* ── 1. Sign-in page: centred logo + welcome background + 3D form ────── */
console.log("\n[1] /signin page");
await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });

const logoBox = await page.locator('a[aria-label="GoDoor home"]').first().boundingBox();
const vw = 1280;
check(
  "logo is horizontally CENTRED on the page",
  !!logoBox && Math.abs(logoBox.x + logoBox.width / 2 - vw / 2) < 12,
  logoBox ? `centre=${Math.round(logoBox.x + logoBox.width / 2)} (page centre=${vw / 2})` : "no logo",
);

check(
  "logo is above the form (masthead, not a corner stamp)",
  !!logoBox && (await page.locator('input[type="email"]').first().boundingBox()).y > logoBox.y,
);

check(
  "welcome background layer is present",
  (await page.locator('div[aria-hidden="true"]').count()) > 0,
);

const cardShadow = await page.locator("form, div").evaluateAll((els) => {
  const hit = els.find((e) => {
    const s = getComputedStyle(e);
    return s.boxShadow && s.boxShadow !== "none" && s.backdropFilter && s.backdropFilter !== "none";
  });
  return hit ? getComputedStyle(hit).boxShadow : "";
});
check("the form card has a real 3D cast shadow", cardShadow.length > 10, cardShadow.slice(0, 60));

const tabBtns = await page.locator(".btn-3d").count();
check("sign-in / create-account are independent 3D buttons", tabBtns >= 3, `${tabBtns} .btn-3d elements`);

check("email + password fields render", (await page.locator('input[type="email"], input[type="password"]').count()) === 2);

/* ── 2. Global header: 3 on the bar, 2 standalone ───────────────────── */
console.log("\n[2] global header (/ — signed out, 390px)");
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(`${BASE}/`, { waitUntil: "networkidle" });

const bar = mob.locator("header .icon-bar").first();
check("the utility bar exists in the header", (await bar.count()) > 0);

if (await bar.count()) {
  const inBar = await bar.locator("button, a").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") || e.getAttribute("title") || e.tagName),
  );
  check("exactly 3 controls share the bar", inBar.length === 3, inBar.join(", "));
  check(
    "bar holds wallet, notifications and theme",
    inBar.some((l) => /wallet/i.test(l)) &&
      inBar.some((l) => /notification/i.test(l)) &&
      inBar.some((l) => /mode/i.test(l)),
    inBar.join(" | "),
  );

  // The two standalone controls must sit OUTSIDE the bar.
  const barBox = await bar.boundingBox();
  const menu = mob.locator('header button[aria-label="Open navigation"]').first();
  const signin = mob
    .locator('header button[aria-label="Sign in"], header a[href="/signin"]')
    .first();

  const menuBox = await menu.count() ? await menu.boundingBox() : null;
  const signinBox = await signin.count() ? await signin.boundingBox() : null;

  check(
    "the menu button is OUTSIDE the bar",
    !!menuBox && (menuBox.x < barBox.x || menuBox.x > barBox.x + barBox.width),
    menuBox ? `menu.x=${Math.round(menuBox.x)} bar=[${Math.round(barBox.x)}..${Math.round(barBox.x + barBox.width)}]` : "hidden at this width",
  );
  check(
    "the account control is OUTSIDE the bar",
    !!signinBox && (signinBox.x < barBox.x || signinBox.x > barBox.x + barBox.width),
    signinBox ? `account.x=${Math.round(signinBox.x)}` : "not found",
  );
  check(
    "the account control is the RIGHTMOST element",
    !!signinBox && (!menuBox || signinBox.x > menuBox.x),
    signinBox ? `account.x=${Math.round(signinBox.x)} menu.x=${menuBox ? Math.round(menuBox.x) : "n/a"}` : "",
  );

  // 3D treatment on the standalone buttons
  const standaloneShadow = await menu.evaluate((el) => getComputedStyle(el).boxShadow).catch(() => "");
  check("standalone button carries a 3D shadow", standaloneShadow && standaloneShadow !== "none", String(standaloneShadow).slice(0, 50));

  const signinShadow = await signin.evaluate((el) => getComputedStyle(el).boxShadow).catch(() => "");
  check("the sign-in control carries a 3D shadow", signinShadow && signinShadow !== "none", String(signinShadow).slice(0, 50));
}

/* ── 3. Desktop width: nav bar replaces the menu button ─────────────── */
console.log("\n[3] global header at 1280px (desktop)");
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

const dBar = page.locator("header .icon-bar").first();
check("desktop: the 3-control utility bar is still present", (await dBar.locator("button, a").count()) === 3);

const dMenu = page.locator('header button[aria-label="Open navigation"]').first();
check("desktop: the hamburger is hidden (nav bar takes over)", !(await dMenu.isVisible().catch(() => false)));

const dNav = page.locator("header nav.nav-bar").first();
check("desktop: the nav bar is present", (await dNav.count()) > 0);

/* ── 4. Tracking map page reachable for the roles ─────────────────── */
console.log("\n[4] /tracking live map");
const t = await ctx.newPage();
await t.goto(`${BASE}/tracking`, { waitUntil: "domcontentloaded" });
const tHead = await t.locator("h1").first().textContent().catch(() => "");
check("tracking page renders a heading", !!tHead && tHead.trim().length > 0, tHead?.trim());
check(
  "tracking page is role-scoped, not a generic 'Live Map'",
  !!tHead && /Track my orders|My live routes|Store deliveries|Live map/.test(tHead),
  tHead?.trim(),
);
const mapCount = await t.locator("canvas").count();
check("a map canvas is mounted", mapCount > 0, `${mapCount} canvas`);

/* ── 5. Black navigation bar + orange selection ─────────────────────── */
console.log("\n[5] black nav bar, orange selection");
await page.goto(`${BASE}/how-it-works`, { waitUntil: "networkidle" });

const palette = await page.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const bar = cs(document.querySelector(".nav-bar"));
  const active = cs(document.querySelector(".nav-pill-active"));
  const idle = cs(document.querySelector(".nav-pill-idle"));
  const icon = cs(document.querySelector(".icon-bar"));
  const btn = cs(document.querySelector(".btn-3d"));
  return {
    barBg: bar?.backgroundImage || bar?.backgroundColor || "",
    activeColor: active?.color || "",
    activeBg: active?.backgroundColor || "",
    activeWeight: active?.fontWeight || "",
    activeLabel: document.querySelector(".nav-pill-active")?.textContent?.trim() || "",
    idleColor: idle?.color || "",
    iconBg: icon?.backgroundImage || icon?.backgroundColor || "",
    btnBg: btn?.backgroundImage || btn?.backgroundColor || "",
    btnColor: btn?.color || "",
  };
});

const isBlack = (v) => /rgba?\((\d+),\s*(\d+),\s*(\d+)/.test(v) && (() => {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return r < 40 && g < 40 && b < 40;
})();
const isOrange = (v) => v === "rgb(249, 115, 22)";

check("the navigation bar is BLACK", isBlack(palette.barBg), palette.barBg.slice(0, 70));
check("the utility icon bar is BLACK", isBlack(palette.iconBg), palette.iconBg.slice(0, 70));
check("the standalone button is BLACK", isBlack(palette.btnBg), palette.btnBg.slice(0, 70));
check(
  "the SELECTED nav pill is ORANGE",
  isOrange(palette.activeColor),
  `text=${palette.activeColor} bg=${palette.activeBg} label="${palette.activeLabel}"`,
);
check("the selected nav pill is bold", palette.activeWeight === "600", palette.activeWeight);
check(
  "idle nav pills are white on the black bar",
  /rgba?\(255,\s*255,\s*255/.test(palette.idleColor),
  palette.idleColor,
);

// Hover a nav pill → it should light orange.
await page.hover(".nav-pill-idle").catch(() => {});
await page.waitForTimeout(400);
const hoverColor = await page.evaluate(() => {
  const el = document.querySelector(".nav-pill-idle");
  return el ? getComputedStyle(el).color : "";
});
check("hovering a nav pill turns it ORANGE", isOrange(hoverColor), hoverColor);

/* ── 6. Bottom nav selection is orange ──────────────────────────────── */
console.log("\n[6] bottom nav active tab");
await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
const floatActive = await page.evaluate(() => {
  const el = document.querySelector(".nav-float-active");
  return el ? getComputedStyle(el).backgroundColor : "";
});
check(
  "the active bottom-nav tab carries an orange wash",
  /249,\s*115,\s*22/.test(floatActive),
  floatActive,
);

await browser.close();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
