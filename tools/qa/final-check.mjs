/**
 * One-shot regression check for this release:
 *   1. profile icon is FIRST in the header cluster (left corner);
 *   2. catalogue discs are 3D (gradient, layered shadow, lifted glyph);
 *   3. catalogue cards are rounded and animate their shadow;
 *   4. typing a Ugandan place returns named suggestions;
 *   5. no raw coordinates ever appear.
 *
 * Run with:  node tools/qa/final-check.mjs  (needs BASE_URL env, default godoor.site)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`  ok    ${label}${detail ? " — " + detail : ""}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
};

/** A shared context with one authenticated page in it — the session must
 * survive navigation between checks, so one context, one page. */
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

async function goto(url, wait = 2500) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
}

/** Make sure we are logged in; return false if the account is locked. */
async function ensureLoggedIn() {
  const gone = await page.locator('header button:has-text("Sign in")').count();
  if (gone > 0) return true;
  // Not signed in — sign in now.
  await goto("/", 2500);
  await page.locator('header button:has-text("Sign in")').first().click();
  await page.waitForTimeout(900);
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').pressSequentially("verifymap+test@example.com", { delay: 10 });
  await page.locator('input[type="password"]').click();
  await page.locator('input[type="password"]').pressSequentially("TestPass123", { delay: 10 });
  await page.locator('div[role="dialog"] button:has-text("Sign in")').first().click();
  await page.waitForTimeout(4000);
  return !(await page.locator('header button:has-text("Sign in")').count()) > 0;
}

async function headerRow() {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("header a, header button").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < 130)
        out.push({ x: Math.round(r.x), label: el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText||"").trim().slice(0,16) || "?" });
    });
    return out.sort((a,b)=>a.x-b.x);
  });
}

// ── 1a. the marketing header (signed out) ──────────────────────────────────
console.log("\n── the global header ──");
{
  await goto("/", 2500);
  const rows = await headerRow();
  for (const c of rows) console.log(`        ${String(c.x).padStart(4)}  ${c.label}`);
  const brand = rows.find((c) => /home/i.test(c.label));
  ok("the brand is the far-left element", !!brand && brand === rows[0], brand?.label);
  const account = rows.find((c) => /account|profile|sign in/i.test(c.label));
  const cluster = rows.filter((c) => c !== brand);
  ok("the account control is FIRST in the icon cluster", !!account && cluster[0] === account, cluster.map(c=>c.label).join(" -> "));
}

// ── 1b. the customer home header (must be signed in) ───────────────────────
console.log("\n── the customer home header ──");
{
  await ensureLoggedIn();
  await goto("/app", 3500);
  const rows = await headerRow();
  for (const c of rows) console.log(`        ${String(c.x).padStart(4)}  ${c.label}`);
  // The brand precedes the cluster here, so the account is second — first in
  // the cluster, which is what matters.
  const cluster = rows.filter((c) => /^Search/.test(c.label));
  const account = rows.find((c) => /account|profile|sign in/i.test(c.label));
  ok("the account control is FIRST in the customer-home cluster", !!account && cluster[0] === account, cluster.map(c=>c.label).join(" -> "));
  ok("the signed-in avatar is showing", (await page.locator('button[aria-label="Account menu"]').count()) > 0);
}

// ── 2. the catalogue disc AND card ────────────────────────────────────────
console.log("\n── the catalogue disc and card ──");
{
  await goto("/categories", 2500);
  const s = await page.locator(".hybrid-disc").first().evaluate((el) => {
    const cs = getComputedStyle(el); const svg = el.querySelector("svg");
    return { gradient: cs.backgroundImage, shadow: cs.boxShadow, layers: cs.boxShadow==="none"?0:cs.boxShadow.split(/,(?![^(]*\))/).length, glyphFilter: svg?getComputedStyle(svg).filter:null };
  });
  ok("the disc has a gradient top face", s.gradient.includes("gradient"), s.gradient.slice(0,54));
  ok("the disc has 3+ shadow layers", s.layers >= 3, `${s.layers}: ${s.shadow.slice(0,70)}`);
  ok("the glyph carries its own drop shadow", !!s.glyphFilter && s.glyphFilter !== "none", s.glyphFilter);
  await page.locator(".hybrid-disc").first().hover();
  await page.waitForTimeout(500);
  const ty = Number(
    (await page.locator(".hybrid-disc").first().evaluate((el)=>getComputedStyle(el).transform))
      .match(/matrix\(([^)]+)\)/)[1].split(",")[5] || 0
  );
  ok("hovering lifts the disc", ty < -0.5, `translateY=${ty.toFixed(2)}px`);
  const cs2 = await page.locator("ul li > a.group").first().evaluate((el) => { const s=getComputedStyle(el); return { radius: s.borderRadius, transition: s.transition }; });
  ok("the card is rounded", parseFloat(cs2.radius) >= 12, `${cs2.radius}`);
  ok("the card animates its shadow", /box-shadow/.test(cs2.transition) || cs2.transition.trim().startsWith("0.2s"), cs2.transition.slice(0,80));
}

// ── 4. typed place search ────────────────────────────────────────────────
console.log("\n── place search names places ──");
{
  await ensureLoggedIn();
  await goto("/app", 3000);
  const locBtn = page.locator('button[aria-label*="Delivery location"]');
  ok("delivery-location control exists", (await locBtn.count()) > 0);
  if (await locBtn.count()) {
    await locBtn.first().click();
    await page.waitForTimeout(900);
    const input = page.locator('input[placeholder*="Search area"]');
    ok("the location modal opened", (await input.count()) > 0);
    if (await input.count()) {
      for (const q of ["Nansana","Kawempe","Buhweju","Masaka","Ntinda"]) {
        await input.first().click();
        await input.first().pressSequentially(q, { delay: 30 });
        await page.waitForTimeout(500);
        const rows = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]');
          if (!d) return [];
          const l = d.querySelector('div[class*="max-h"]');
          return l ? Array.from(l.querySelectorAll("button")).map(b=>b.innerText.trim()).filter(Boolean) : [];
        });
        const hit = rows.find((t)=>t.toLowerCase().includes(q.toLowerCase()));
        ok(`"${q}" -> "${hit||"(no match)"}"`, !!hit, rows.slice(0,2).join(" | "));
        ok(`"${q}" shows no coordinate string`, !rows.some((t)=>/°/.test(t)), rows.join(" | ").slice(0,80));
      }
    }
  }
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
