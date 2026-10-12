import { chromium } from "playwright";

const EXEC = "/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));

await page.goto("https://godoor.site/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

const text = await page.evaluate(() => document.body.innerText);

const want = [
  ["Discover and order", /Discover and order/i],
  ["Order Now CTA", /Order Now/i],
  ["promo banner 40%", /40%/i],
  ["category rail", /Pharmacy/i],
  ["Popular picks", /Popular/i],
  ["Delivery preference", /Deliver|Schedule/i],
  ["Table booking", /Book a Table|Reserve Your Spot/i],
  ["How it works", /How it works/i],
  ["merchant CTA", /Register|Start selling/i],
  ["rider CTA", /Drive|Earn/i],
  ["wallet/Morse", /Morse|Wallet/i],
  ["tracking", /track/i],
  ["app download", /APK|download/i],
];

for (const [label, re] of want) {
  console.log(`${re.test(text) ? "PASS" : "MISS"}  ${label}`);
}

console.log("\n--- structure ---");
const info = await page.evaluate(() => {
  const secs = [...document.querySelectorAll("section")].length;
  const h1 = document.querySelector("h1")?.innerText?.slice(0, 70) || null;
  return {
    sections: secs,
    h1,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    imgsBroken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
    imgs: document.images.length,
    h2s: [...document.querySelectorAll("h2")].map((h) => h.innerText.trim().slice(0, 46)).filter(Boolean),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log("\npageerrors:", errors.length ? errors : "none");

await browser.close();