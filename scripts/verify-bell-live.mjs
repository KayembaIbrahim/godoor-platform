/**
 * Signed-in customer-home check: does the notification bell panel actually
 * expose the alerts opt-in, and is the category rail linking to browse pages?
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`;
const env = {};
for (const line of readFileSync(".env.vercel-prod", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });

await page.goto("https://godoor.site/", { waitUntil: "domcontentloaded", timeout: 60000 });

// Sign in through the app's own modal.
await page.evaluate(async (anon) => {
  const r = await fetch(
    "https://llzqkduccdbbetevpoql.supabase.co/auth/v1/token?grant_type=password",
    {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ibrahimkapoor11@gmail.com", password: "Kayemba@256" }),
    },
  );
  const j = await r.json();
  if (!j.access_token) throw new Error("signin failed: " + JSON.stringify(j).slice(0, 120));
  localStorage.setItem("sb-llzqkduccdbbetevpoql-auth-token", JSON.stringify({
    access_token: j.access_token, refresh_token: j.refresh_token, token_type: "bearer",
    expires_in: j.expires_in, expires_at: Math.floor(Date.now() / 1000) + j.expires_in,
    user: j.user,
  }));
}, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

await page.goto("https://godoor.site/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  const bell = document.querySelector('button[aria-label="Notifications"]');
  const chips = [...document.querySelectorAll('a[href^="/browse/"]')].map((a) => ({
    text: a.textContent.trim().slice(0, 28),
    href: decodeURIComponent(a.getAttribute("href")),
  }));
  return {
    bellPresent: !!bell,
    chipCount: chips.length,
    chips: chips.slice(0, 5),
  };
});

// Open the bell panel and look for the alerts opt-in.
let panel = { opened: false, pushRow: false, text: "" };
if (out.bellPresent) {
  await page.click('button[aria-label="Notifications"]');
  await page.waitForTimeout(1200);
  panel = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((p) => /Delivery notifications/i.test(p.textContent));
    const body = document.body.innerText;
    return {
      opened: true,
      pushRow: !!el,
      text: body.includes("Notifications") ? "panel rendered" : "no panel",
    };
  });
}

console.log(JSON.stringify({ ...out, panel, errors: [...new Set(errs)].slice(0, 5) }, null, 2));
await browser.close();