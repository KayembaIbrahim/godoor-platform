const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--disable-dev-shm-usage','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // sign in
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1500);
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(5000);
  console.log('signed in ->', page.url());
  for (const url of ['https://godoor.site/', 'https://godoor.site/app', 'https://godoor.site/orders', 'https://godoor.site/tracking?orderId=aaaa1111-bbbb-cccc-dddd-eeeeffff0001', 'https://godoor.site/explore']) {
    const errs = [];
    const onErr = e => errs.push(e.message.slice(0,60));
    page.on('pageerror', onErr);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    page.off('pageerror', onErr);
    console.log(url.padEnd(72), '->', errs.length ? errs.join(' | ') : 'clean');
  }
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
