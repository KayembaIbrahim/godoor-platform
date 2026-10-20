const { chromium } = require('playwright');
const ORDER = 'aaaa1111-bbbb-cccc-dddd-eeeeffff0001';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { const t = m.text().slice(0,300); if (m.type()==='error') errs.push('ERR:'+t); });
  page.on('pageerror', e => errs.push('PAGE:'+e.message.slice(0,200)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // Use the actual auth modal behaviour: find the login trigger, click, fill
  const loginBtn = page.locator('[aria-label="Sign in"]').first();
  if (await loginBtn.count()) { await loginBtn.click(); await page.waitForTimeout(1200); }
  const inputs = await page.$$('input[type=email], input[name="email"]');
  if (inputs.length) {
    await inputs[0].fill('verifymap+test@example.com');
    const pw = await page.$('input[type=password]') || await page.$('input[name="password"]');
    if (pw) await pw.fill('TestPass123');
    const sub = page.locator('button[type=submit], button:has-text("Sign in"), a:has-text("Sign in")').last();
    await sub.click();
    await page.waitForTimeout(5000);
    console.log('after login URL:', page.url());
  }
  await page.goto(`https://godoor.site/tracking?orderId=${ORDER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15000);
  const r = await page.evaluate(() => ({
    heading: document.body.innerText.replace(/\s+/g,' ').trim().slice(0, 500),
    errCount: 0,
    markers: [...document.querySelectorAll('.mapboxgl-marker')].length,
    pilines: [...document.querySelectorAll('.mapboxgl-line, .gdr-marker')].length,
    children: [...document.querySelectorAll('.mapboxgl-marker')].slice(0,3).map(e=>e.outerHTML.slice(0,150)),
    anyMarkerLike: [...document.querySelectorAll('[class*="marker"]')].map(e=>({cls:e.className,x:Math.round(e.getBoundingClientRect().x)}).filter((_,i)=>i<3)),
  }));
  console.log('HEADING:', JSON.stringify(r.heading));
  console.log('markers:', r.markers, '| other markers:', r.pilines);
  console.log('errors:', errs.slice(0,6));
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
