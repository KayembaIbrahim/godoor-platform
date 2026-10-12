/**
 * Design-quality audit.
 *
 * This model has no image input, so "it looks horrible" cannot be answered by
 * looking. These are the objective properties a human eye rejects, measured
 * from the live DOM:
 *
 *   1. composite contrast   — text vs what is actually painted behind it
 *   2. hue chaos            — how many competing accent families are on screen
 *   3. group inconsistency   — sibling cards in one grid that do not match
 *   4. type-scale drift      — how many distinct font sizes the page invents
 *   5. spacing rhythm        — gaps that break the vertical rhythm
 *
 * Usage: AUDIT_PW=... node scripts/design-quality-audit.mjs [path] [theme]
 */
import { chromium } from "playwright";

const EXE = "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";
const EMAIL = process.env.AUDIT_EMAIL || "ibrahimkapoor11@gmail.com";
const PW = process.env.AUDIT_PW || "";
const TARGET = process.argv[2] || "/app";
const THEME = process.argv[3] || "light";
const W = Number(process.env.AUDIT_W || 390);

const browser = await chromium.launch({
  executablePath: EXE,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--js-flags=--max-old-space-size=384",
    "--disable-features=IsolateOrigins,site-per-process",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: W, height: 844 } });

  // Theme must be set before the app boots, or the store overwrites it.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("godoor-theme-v5-white", JSON.stringify({ state: { theme: t } }));
    } catch {}
  }, THEME);

  await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });

  if (PW) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button,a")].find((e) =>
        /^(sign in|log in)$/i.test((e.textContent || "").trim()),
      );
      b?.click();
    });
    await page.waitForSelector('[role="dialog"]', { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const b = [...(d?.querySelectorAll("button") || [])].find((e) =>
        /already have an account/i.test((e.textContent || "").trim()),
      );
      b?.click();
    });
    await page.waitForSelector('[role="dialog"] input[type="email"]', { timeout: 25000 });
    await page.fill('[role="dialog"] input[type="email"]', EMAIL);
    await page.fill('[role="dialog"] input[type="password"]', PW);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) =>
        /^(sign in|create account)$/i.test((e.textContent || "").trim()),
      );
      b?.click();
    });
    await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 30000 }).catch(() => {});
  }

  await page.waitForTimeout(9000);

  const report = await page.evaluate(() => {
    // ---- colour maths -------------------------------------------------------
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || "");
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
      a: 1,
    });
    const lum = (c) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const hue = (c) => {
      const mx = Math.max(c.r, c.g, c.b),
        mn = Math.min(c.r, c.g, c.b);
      if (mx === mn) return -1;
      let h;
      const d = mx - mn;
      if (mx === c.r) h = ((c.g - c.b) / d) % 6;
      else if (mx === c.g) h = (c.b - c.r) / d + 2;
      else h = (c.r - c.g) / d + 4;
      return Math.round(((h * 60) + 360) % 360);
    };

    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        parseFloat(cs.opacity) > 0.05
      );
    };

    // Composite every ancestor background down to the page, honouring alpha.
    const bgOf = (el) => {
      const stack = [];
      let n = el;
      while (n && n !== document.documentElement.parentNode) {
        const cs = getComputedStyle(n);
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) stack.push(c);
        const bi = parse(cs.backgroundImage);
        if (bi && bi !== "rgba(0, 0, 0, 0)") stack.push({ r: 255, g: 255, b: 255, a: 0.001 });
        n = n.parentElement;
      }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      const root = parse(getComputedStyle(document.body).backgroundColor);
      if (root && root.a > 0) base = root;
      let acc = base;
      for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
      return acc;
    };

    // ---- 1. composite contrast --------------------------------------------
    const textNodes = [...document.querySelectorAll("h1,h2,h3,h4,p,span,a,button,li,label,td,th,div")]
      .filter((el) => el.children.length === 0 && vis(el))
      .map((el) => {
        const t = (el.textContent || "").trim();
        if (!t) return null;
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        if (!fg || fg.a === 0) return null;
        const bg = bgOf(el.parentElement || el);
        const solid = fg.a < 1 ? over(fg, bg) : fg;
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        const r = ratio(solid, bg);
        return {
          t: t.slice(0, 42),
          size,
          ratio: Math.round(r * 100) / 100,
          need,
          fail: r < need,
          fg: cs.color,
          bg: `rgb(${bg.r},${bg.g},${bg.b})`,
        };
      })
      .filter(Boolean);

    // ---- 2. hue chaos -------------------------------------------------------
    const hueBuckets = {};
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      for (const prop of ["color", "backgroundColor", "borderTopColor"]) {
        const c = parse(cs[prop]);
        if (!c || c.a < 0.35) continue;
        const solid = c.a < 1 ? over(c, bgOf(el)) : c;
        const mx = Math.max(solid.r, solid.g, solid.b),
          mn = Math.min(solid.r, solid.g, solid.b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat < 0.22) continue; // greys are not "colour"
        const h = hue(solid);
        const bucket = Math.floor(h / 30) * 30;
        hueBuckets[bucket] = (hueBuckets[bucket] || 0) + 1;
      }
    }
    const hues = Object.entries(hueBuckets)
      .sort((a, b) => b[1] - a[1])
      .map(([h, n]) => ({ deg: Number(h), uses: n }));

    // ---- 3. group inconsistency --------------------------------------------
    // Cluster visible cards by their parent, then report groups whose children
    // disagree on the properties that make a grid read as one system.
    const cards = [...document.querySelectorAll("a,button,article,li")].filter(
      (el) =>
        vis(el) &&
        el.getBoundingClientRect().width >= 44 &&
        el.getBoundingClientRect().height >= 44,
    );
    const groups = new Map();
    for (const c of cards) {
      const p = c.parentElement;
      if (!p) continue;
      const kids = [...p.children].filter(
        (k) => k.getBoundingClientRect().width >= 44 && k.getBoundingClientRect().height >= 44,
      );
      if (kids.length < 3) continue;
      if (!groups.has(p)) groups.set(p, kids.slice(0, 12));
    }
    const inconsistent = [];
    for (const [p, kids] of groups) {
      if (kids.length < 3) continue;
      const sig = kids.map((k) => {
        const cs = getComputedStyle(k);
        const bg = parse(cs.backgroundColor);
        const bd = parse(cs.borderTopColor);
        return {
          radius: cs.borderTopLeftRadius,
          bg: bg ? `${bg.r},${bg.g},${bg.b},${bg.a}` : "none",
          border: bd ? `${bd.r},${bd.g},${bd.b},${bd.a}` : "none",
          borderW: cs.borderTopWidth,
          pad: cs.padding,
          label: (k.getAttribute("aria-label") || k.textContent || "").trim().slice(0, 26),
        };
      });
      const uniq = (f) => new Set(sig.map(f)).size;
      const issues = [];
      if (uniq((s) => s.radius) > 1) issues.push(`radius ${uniq((s) => s.radius)} variants`);
      if (uniq((s) => s.pad) > 1) issues.push(`padding ${uniq((s) => s.pad)} variants`);
      if (uniq((s) => s.borderW) > 1) issues.push(`border-width ${uniq((s) => s.borderW)} variants`);
      if (issues.length) {
        inconsistent.push({
          group: (p.textContent || "").trim().slice(0, 40),
          count: kids.length,
          issues,
          members: sig.map((s) => s.label),
        });
      }
    }

    // ---- 4. type scale ------------------------------------------------------
    const sizes = {};
    for (const el of document.querySelectorAll("h1,h2,h3,h4,p,span,a,button,li,div")) {
      if (el.children.length || !vis(el)) continue;
      if (!(el.textContent || "").trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.textTransform === "uppercase") continue;
      const s = Math.round(parseFloat(cs.fontSize));
      sizes[s] = (sizes[s] || 0) + 1;
    }
    const typeScale = Object.entries(sizes)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([s, n]) => ({ px: Number(s), uses: n }));

    return {
      url: location.pathname,
      theme: document.documentElement.className,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      contrast: {
        total: textNodes.length,
        failures: textNodes.filter((t) => t.fail).length,
        worst: textNodes
          .filter((t) => t.fail)
          .sort((a, b) => a.ratio - b.ratio)
          .slice(0, 15),
      },
      hueChaos: { distinctHueBands: hues.length, buckets: hues.slice(0, 12) },
      inconsistentGroups: inconsistent.slice(0, 8),
      typeScale: { distinct: typeScale.length, sizes: typeScale },
    };
  });

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
