/**
 * Live audit of every issue the operator reported on the customer home,
 * across all three roles. Signs in for real, so nothing is inferred.
 */
import { chromium } from "playwright";
import type { Browser } from "playwright";

const BASE = "https://godoor.site";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASS = "Kayemba@256";

type Out = Record<string, unknown>;

async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function signIn(page: import("playwright").Page) {
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const btn = page.getByRole("button", { name: /^sign in$/i }).first();
  await btn.waitFor({ timeout: 30000 });
  await btn.click();
  // Login is the default view now; only switch when the form actually opened
  // on sign-up.
  const switcher = page.getByRole("button", { name: /already have an account|sign in instead|log ?in instead/i }).first();
  if (await switcher.count()) {
    await switcher.click().catch(() => {});
  }
  await page.waitForTimeout(600);
  /* HeaderAuth renders bare <input> elements with no <form> wrapper, so the old
     `form input` selector matched nothing and this suite failed before it ever
     signed in — pre-existing drift, not an auth regression. */
  const inputs = page.locator('input[type="email"], input[type="password"]');
  const n = await inputs.count();
  if (n < 2) throw new Error(`no inputs in auth modal (found ${n})`);
  await inputs.nth(0).fill(EMAIL);
  await inputs.nth(1).fill(PASS);
  await page.getByRole("button", { name: /^(sign in|log ?in)$/i }).last().click();
  await page.waitForTimeout(5000);
}

async function audit(page: import("playwright").Page, label: string): Promise<Out> {
  return await page.evaluate((lbl: string) => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05;
    };
    const txt = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim();

    // --- theme toggles: buttons that flip dark/light ---
    const toggles: string[] = [];
    for (const b of document.querySelectorAll("button, [role=button]")) {
      if (!vis(b)) continue;
      const label = (b.getAttribute("aria-label") || b.getAttribute("title") || txt(b) || "").trim();
      const l = label.toLowerCase();
      const svg = b.querySelector("svg");
      const sunMoon = svg && /lucide-(sun|moon)/i.test(svg.getAttribute("class") || "");
      if (/dark|light|theme|night/i.test(l) || sunMoon) toggles.push(label || "(icon-only)");
    }

    // --- logos actually rendered ---
    const logos = [...document.querySelectorAll("img")]
      .filter((i) => /logo/i.test(i.getAttribute("src") || "") && vis(i))
      .map((i) => {
        const r = i.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top + window.scrollY)}`;
      });

    // --- light mode surface audit ---
    const htmlCls = document.documentElement.className;
    const bg = getComputedStyle(document.body).backgroundColor;

    // --- wallet card content ---
    const bodyTxt = txt(document.body);
    const walletish = /godoor pay/i.test(bodyTxt);
    const hasEscrow = /escrow/i.test(bodyTxt);
    const hasWithdraw = /withdraw/i.test(bodyTxt);
    const hasSigninPrompt = /sign in to see your balance/i.test(bodyTxt);
    const moneyOnHome = /UGX\s?[\d,]+/i.test(bodyTxt);

    // --- pin / security ---
    const pinish = /transaction pin|set (your )?pin|wallet pin|biometric|fingerprint|security pin/i.test(bodyTxt);

    // --- fonts actually applied ---
    const bodyFont = getComputedStyle(document.body).fontFamily;
    const headingFont = getComputedStyle(document.querySelector("h1,h2") || document.body).fontFamily;
    const fontsLoaded = [...document.fonts].filter((f: FontFace) => f.status === "loaded").map((f: FontFace) => f.family);

    // --- perf: how many network requests by now ---
    return {
      label: lbl,
      url: location.pathname,
      themeToggles: toggles.length,
      toggleLabels: toggles,
      logos: logos.length,
      logoGeom: logos,
      htmlClass: htmlCls,
      bodyBg: bg,
      walletCard: walletish,
      escrowText: hasEscrow,
      withdrawAction: hasWithdraw,
      signinPrompt: hasSigninPrompt,
      moneyFigureOnScreen: moneyOnHome,
      pinOrSecurity: pinish,
      bodyFont,
      headingFont,
      fontsLoaded: [...new Set(fontsLoaded)],
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navLinks: [...document.querySelectorAll("nav a")].filter(vis).map((a) => txt(a)).slice(0, 8),
    };
  }, label);
}

async function main() {
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 120)); });

    await signIn(page);

    const out: Out = {};
    out.customerHome = await audit(page, "customer home");
    out.errors = errors.slice(0, 8);

    for (const path of ["/wallet", "/rider/earnings", "/business/earnings", "/checkout"]) {
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3500);
        out[path] = await audit(page, path);
      } catch (e) {
        out[path] = { error: String(e).slice(0, 120) };
      }
    }
    console.log(JSON.stringify(out, null, 2));
  });
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });