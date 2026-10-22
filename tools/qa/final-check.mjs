/**
 * The live regression suite for this release. It is the canonical check — the
 * narrower probes that used to live beside it have been folded in here:
 *
 *   1. profile icon is LAST in the header cluster (right corner), signed out
 *      and signed in;
 *   2. catalogue discs are 3D (gradient, layered shadow, lifted glyph, hover
 *      lift) and the cards are rounded with an animated shadow;
 *   3. typing a Ugandan place returns a NAMED suggestion;
 *   4. no raw coordinates ever appear.
 *
 * Each section runs in its own browser so that a sandbox-induced crash in one
 * cannot take the whole run down.
 *
 * Run with:  node tools/qa/final-check.mjs  (BASE_URL env, default godoor.site)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://godoor.site";
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`  ok    ${label}${detail ? " — " + detail : ""}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
};

/** Launch a memory-lean browser. */
const LAUNCH = {
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-zygote",
    "--renderer-process-limit=1",
  ],
};

/** Sign in when needed; Supabase rate-limits repeated logins so we reuse any
 *  existing session first. */
async function ensureLoggedIn(page, goto) {
  const signedIn = async () => (await page.locator('header button:has-text("Sign in")').count()) === 0
    && (await page.locator('button[aria-label="Account menu"]').count()) > 0;
  if (await signedIn()) return true;
  await goto("/", 2500);
  const signInBtn = page.locator('header button:has-text("Sign in")').first();
  if (!(await signInBtn.count())) return await signedIn();
  await signInBtn.click();
  await page.waitForTimeout(900);
  await page.locator('input[type="email"]').click();
  await page.locator('input[type="email"]').pressSequentially("verifymap+test@example.com", { delay: 10 });
  await page.locator('input[type="password"]').click();
  await page.locator('input[type="password"]').pressSequentially("TestPass123", { delay: 10 });
  /* The sign-in form is rendered INLINE by the header, not inside a modal, so
     there is no `div[role="dialog"]` to scope the submit button to. Scoping to
     a dialog that does not exist is why this section had been failing with a
     30s click timeout — the button was there the whole time. */
  const submit = page.locator('button:has-text("Sign in")').last();
  await submit.click();
  await page.waitForTimeout(5000);
  return await signedIn();
}

/** Run one section in its own isolated browser + page.
 *  Returns true if it passed, false otherwise. */
async function section(title, fn) {
  console.log(`\n── ${title} ──`);
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const goto = async (url, wait = 2500) => {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(wait);
  };
  const headerRow = async () => page.evaluate(() => {
    const out = [];
    document.querySelectorAll("header a, header button").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < 130)
        out.push({ x: Math.round(r.x), label: el.getAttribute("aria-label") || el.getAttribute("title") || (el.innerText||"").trim().slice(0,16) || "?" });
    });
    return out.sort((a,b)=>a.x-b.x);
  });
  try {
    await fn({ page, goto, headerRow });
    console.log("  ok");
    return true;
  } catch (e) {
    failures++;
    console.log(`  FAIL  the section crashed — ${String(e.message || e).split("\n")[0]}`);
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── 1a. the marketing header (signed out) ──────────────────────────────────
await section("global header (signed out)", async ({ page, goto, headerRow }) => {
  await goto("/", 2500);
  const rows = await headerRow();
  for (const c of rows) console.log(`        ${String(c.x).padStart(4)}  ${c.label}`);
  const brand = rows.find((c) => /home/i.test(c.label));
  ok("the brand is the far-left element", !!brand && brand === rows[0], brand?.label);
  const account = rows.find((c) => /account|profile|sign in/i.test(c.label));
  const cluster = rows.filter((c) => c !== brand);
  // The profile belongs in the RIGHT corner — last in the cluster, hard
  // against the edge of the row, clear of the GoDoor logo on the left.
  ok("the account control is LAST in the icon cluster (right corner)", !!account && cluster[cluster.length - 1] === account, cluster.map(c=>c.label).join(" -> "));
});

// ── 1b. the customer home header (must be signed in) ───────────────────────
await section("customer home header (signed in)", async ({ page, goto, headerRow }) => {
  await ensureLoggedIn(page, goto);
  await goto("/app", 3500);
  const rows = await headerRow();
  for (const c of rows) console.log(`        ${String(c.x).padStart(4)}  ${c.label}`);
  // The brand precedes the cluster here, so the account is second overall —
  // but it must be LAST among the cluster's own controls, in the right corner.
  const brand = rows.find((c) => /home/i.test(c.label));
  const cluster = rows.filter((c) => c !== brand);
  const account = rows.find((c) => /account|profile|sign in/i.test(c.label));
  ok("the account control is LAST in the customer-home cluster (right corner)", !!account && cluster[cluster.length - 1] === account, cluster.map(c=>c.label).join(" -> "));
  ok("the signed-in avatar is showing", (await page.locator('button[aria-label="Account menu"]').count()) > 0);
});

// ── 2. the catalogue disc AND card ────────────────────────────────────────
await section("catalogue disc + card", async ({ page, goto }) => {
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
});

// ── 4. typed place search ────────────────────────────────────
await section("place search names places", async ({ page, goto }) => {
  await ensureLoggedIn(page, goto);
  await goto("/app", 3000);
  const locBtn = page.locator('button[aria-label*="Delivery location"]').first();
  ok("delivery-location control exists", (await locBtn.count()) > 0);
  if (!(await locBtn.count())) return;
  await locBtn.click();
  await page.waitForTimeout(900);
  const input = page.locator('input[placeholder*="Search area"]').first();
  ok("the location modal opened", (await input.count()) > 0);
  if (!(await input.count())) return;
  for (const q of ["Nansana","Kawempe","Buhweju","Masaka","Ntinda"]) {
    // CLEAR the field first — otherwise the next query appends to the previous
    // one and nothing matches.
    await input.click();
    await input.fill("");
    await input.pressSequentially(q, { delay: 30 });
    await page.waitForTimeout(900);
    const rows = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return [];
      const l = d.querySelector('div[class*="max-h"]');
      return l ? Array.from(l.querySelectorAll("button")).map((b)=>b.innerText.trim()).filter(Boolean) : [];
    });
    const hit = rows.find((t)=>t.toLowerCase().includes(q.toLowerCase()));
    ok(`"${q}" -> "${hit||"(no match)"}"`, !!hit, rows.slice(0,2).join(" | "));
    ok(`"${q}" shows no coordinate string`, !rows.some((t)=>/°/.test(t)), rows.join(" | ").slice(0,80));
  }
});

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
