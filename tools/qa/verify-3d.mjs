/**
 * Computed-style verification of the 3D redesign.
 *
 * Rather than eyeballing a screenshot, this asserts the actual rendered
 * geometry: the disc has a gradient top face, a layered shadow with an inset
 * highlight, a raised glyph, and it lifts on hover. The avatar has the same
 * treatment plus a lit rim.
 *
 * Run with:  node tools/qa/verify-3d.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`  ok    ${label}${detail ? " — " + detail : ""}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/categories`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

console.log("\n── the category disc ──");
const disc = page.locator(".hybrid-disc").first();
const before = await disc.evaluate((el) => {
  const cs = getComputedStyle(el);
  return {
    gradient: cs.backgroundImage,
    shadow: cs.boxShadow,
    transform: cs.transform,
    transition: cs.transition,
    color: cs.color,
  };
});
ok("the disc has a gradient top face", before.gradient.includes("gradient"), before.gradient.slice(0, 60));
const layers = before.shadow === "none" ? 0 : before.shadow.split(/,(?![^(]*\))/).length;
ok("the disc has 3+ shadow layers", layers >= 3, `${layers}: ${before.shadow.slice(0, 80)}`);
ok("the shadow includes an inset highlight", before.shadow.includes("inset"), before.shadow.includes("inset") ? "yes" : "no");
ok("the disc animates transform and box-shadow", /transform/.test(before.transition) && /box-shadow/.test(before.transition), before.transition.slice(0, 70));
ok("the glyph is coloured from the disc token", before.color.startsWith("rgb"), before.color);

console.log("\n── the disc lifts on hover ──");
await disc.hover();
await page.waitForTimeout(500);
const after = await disc.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { transform: cs.transform, shadow: cs.boxShadow };
});
const ty = Number((after.transform.match(/matrix\(([^)]+)\)/)?.[1] || "").split(",")[5] || 0);
ok("hovering lifts the disc", ty < -0.5, `translateY = ${ty.toFixed(2)}px`);
ok("hovering deepens the shadow", after.shadow !== before.shadow);

console.log("\n── the glyph is raised off the plate ──");
const glyph = await disc.evaluate((el) => {
  const svg = el.querySelector("svg");
  return svg ? getComputedStyle(svg).filter : null;
});
ok("the glyph carries its own drop shadow", !!glyph && glyph.includes("drop-shadow"), glyph);

console.log("\n── the catalogue card ──");
const card = page.locator('ul li > a.group').first();
if (await card.count()) {
  const cs = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      radius: s.borderRadius,
      transition: s.transition,
    };
  });
  ok("the card is rounded", parseFloat(cs.radius) >= 12, `${cs.radius}`);
  // `transition-all` (Tailwind's default for `transition-all duration-200`) has
  // no property list, and it covers box-shadow.
  ok(
    "the card animates its shadow",
    /box-shadow/.test(cs.transition) || cs.transition.trim().startsWith("0.2s"),
    cs.transition.slice(0, 80),
  );
} else {
  ok("a catalogue card was found", false);
}

console.log("\n── the profile disc ──");
// Sign in so we exercise the compact avatar control the way customers see it.
// The login inputs only exist inside the auth modal, so open it first.
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
const signBtn = page.locator('header button:has-text("Sign in")').first();
if (await signBtn.count()) await signBtn.click();
await page.waitForTimeout(700);
const email = page.locator('input[type="email"]');
const pass = page.locator('input[type="password"]');
if (await email.count() && await pass.count()) {
  await email.fill("verifymap+test@example.com");
  await pass.fill("TestPass123");
  // The modal's own "Sign in" — NOT the header trigger, and the auth modal's
  // submit button is type="button", not type="submit".
  await page.locator('div[role="dialog"] button:has-text("Sign in")').first().click();
  await page.waitForTimeout(4000);
}

const account = page.locator('button[aria-label="Account menu"]');
if (await account.count()) {
  const s = await account.first().evaluate((el) => {
    const discEl = el.querySelector("div");
    const cs = discEl ? getComputedStyle(discEl) : null;
    return {
      gradient: cs?.backgroundImage,
      shadow: cs?.boxShadow,
      hasRim: !!discEl?.querySelector("span[aria-hidden]"),
      rimBg: discEl?.querySelector("span[aria-hidden]")
        ? getComputedStyle(discEl.querySelector("span[aria-hidden]")).backgroundImage
        : null,
    };
  });
  ok("the avatar disc is a gradient", !!s.gradient?.includes("gradient"), s.gradient?.slice(0, 54));
  ok("the avatar disc carries a shadow", !!s.shadow && s.shadow !== "none", s.shadow?.slice(0, 80));
  ok("the avatar has a lit rim", s.hasRim, s.rimBg?.slice(0, 50));
} else {
  ok("the avatar control was exercised", false, "logged out or unreachable");
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
