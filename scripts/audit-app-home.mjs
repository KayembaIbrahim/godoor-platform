/**
 * Signed-in audit of the customer home (/app).
 *
 * Answers the two things that were reported:
 *   1. duplicate logos at the top of the screen
 *   2. structural breakage / "rubbish" layout
 *
 * Everything below is measured from the live DOM and computed styles rather
 * than inferred from source, because the reports are visual.
 */
import { chromium } from "playwright";

const EXE = "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";
const EMAIL = process.env.AUDIT_EMAIL || "ibrahimkapoor11@gmail.com";
const PW = process.env.AUDIT_PW || "Kayemba@256";
const WIDTH = Number(process.env.AUDIT_W || 390);

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

const consoleErrors = [];
const failedRequests = [];

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 844 } });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  });
  page.on("requestfailed", (r) => {
    failedRequests.push(`${r.failure()?.errorText} ${r.url().slice(0, 100)}`);
  });

  await page.goto("https://godoor.site/", { waitUntil: "domcontentloaded", timeout: 60000 });

  // Open the sign-in modal.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,a")].find((e) =>
      /^(sign in|log in)$/i.test((e.textContent || "").trim()),
    );
    b?.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 25000 });

  // The modal opens in signup mode, which asks for a Morse username as well.
  // Switch to sign-in so the two-field form is what's on screen.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((e) =>
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

  await page.waitForURL((u) => u.pathname.startsWith("/app"), { timeout: 30000 });
  // Let the dashboard hydrate: the catalogue/merchants settle after a few
  // seconds, and that is where stuck states show up.
  await page.waitForTimeout(9000);

  const report = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };

    // Every visible image, with its resolved box — this is what proves or
    // disproves a "double logo".
    const images = [...document.querySelectorAll("img")]
      .filter(vis)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          src: (el.currentSrc || el.src || "").split("/").pop(),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          parentTag: el.parentElement?.tagName,
          headerish: !!el.closest("header"),
        };
      });

    // Brand logos specifically, to spot the duplicate.
    const logos = images.filter((i) => /godoor-(logo|mark)/.test(i.src || ""));

    // Anything wider than the viewport = horizontal overflow.
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;

    // Text that looks clipped by its own box.
    const clipped = [...document.querySelectorAll("h1,h2,h3,p,span,button,a")]
      .filter((el) => el.children.length === 0 && vis(el))
      .filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "visible")
      .map((el) => (el.textContent || "").trim().slice(0, 50))
      .filter(Boolean)
      .slice(0, 10);

    // Section headings, to reconstruct the visual hierarchy.
    const headings = [...document.querySelectorAll("h2,h3")]
      .filter(vis)
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 25);

    const stuck = [...document.querySelectorAll("p,span,div")]
      .filter(vis)
      .map((el) => (el.textContent || "").trim())
      .filter((t) => /detecting|loading|find\w*|searching/i.test(t) && t.length < 60)
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 10);

    return {
      url: location.pathname,
      htmlClass: document.documentElement.className,
      logos,
      imageCount: images.length,
      topImages: images.filter((i) => i.y < 300),
      docW,
      winW,
      overflowPx: docW - winW,
      h1: [...document.querySelectorAll("h1")].filter(vis).map((e) => e.textContent.trim()),
      headings,
      clipped,
      stuck,
      navs: [...document.querySelectorAll("nav")].filter(vis).map((n) => {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return {
          position: cs.position,
          h: Math.round(r.height),
          links: n.querySelectorAll("a").length,
        };
      }),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  await page.screenshot({ path: "/tmp/app-home.png", fullPage: false });

  console.log(JSON.stringify({ ...report, consoleErrors, failedRequests }, null, 2));
} finally {
  await browser.close();
}