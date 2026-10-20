const { chromium } = require('playwright');
const ORDER = 'aaaa1111-bbbb-cccc-dddd-eeeeffff0001';
(async () => {
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--disable-dev-shm-usage','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1500);
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(5000);

  // fetch the server HTML for the tracking page WITH the session cookie
  const serverHtml = await page.evaluate(async (ORDER) => {
    const r = await fetch(`/tracking?orderId=${ORDER}`, { credentials: 'include' });
    return await r.text();
  }, ORDER);
  require('fs').writeFileSync('/tmp/server_tracking.html', serverHtml);

  await page.goto(`https://godoor.site/tracking?orderId=${ORDER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const clientHtml = await page.evaluate(() => document.getElementById('__next')?.outerHTML || document.body.innerHTML);
  require('fs').writeFileSync('/tmp/client_tracking.html', clientHtml);
  console.log('server', serverHtml.length, 'client', clientHtml.length);
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
