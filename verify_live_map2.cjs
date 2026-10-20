const { chromium } = require('playwright');
const ORDER = 'aaaa1111-bbbb-cccc-dddd-eeeeffff0001';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,200)); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0,200)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const si = page.locator('button:has-text("Sign in"), a:has-text("Sign in")').first();
  if (await si.count()) { await si.click(); await page.waitForTimeout(1500); }
  const em = page.locator('input[type="email"], input[name="email"]').first();
  const pw = page.locator('input[type="password"], input[name="password"]').first();
  await em.fill('verifymap+test@example.com'); await pw.fill('TestPass123');
  await page.locator('button[type="submit"]').last().click();
  await page.waitForTimeout(4000);
  await page.goto(`https://godoor.site/tracking?orderId=${ORDER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  const r = await page.evaluate(() => ({
    markers: document.querySelectorAll('.mapboxgl-marker').length,
    markerHTML: [...document.querySelectorAll('.mapboxgl-marker')].map(e=>e.outerHTML.slice(0,200)),
    text: document.body.innerText.slice(0, 600),
    canvasCount: document.querySelectorAll('.mapboxgl-canvas').length,
    mapChildren: [...(document.querySelector('.mapboxgl-map')?.children||[])].map(c=>c.className),
  }));
  console.log(JSON.stringify(r, null, 2));
  console.log('ERRORS:', errs.slice(0,10));
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
