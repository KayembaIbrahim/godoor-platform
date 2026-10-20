const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--disable-dev-shm-usage','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('#'+e.message.slice(0,50)));
  // sign in
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1200);
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(5000);
  console.log('signed in ->', page.url());
  for (const url of ['https://godoor.site/','https://godoor.site/app','https://godoor.site/tracking?orderId=aaaa1111-bbbb-cccc-dddd-eeeeffff0001']) {
    errs.length = 0;
    page.on('pageerror', e => errs.push('#'+e.message.slice(0,50)));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(9000);
    console.log(url.padEnd(66), '->', errs.length ? errs.join(' ') : 'CLEAN');
  }
  // back to /app, check build badge now shows commit
  await page.evaluate(() => {}).catch(()=>{});
  const badge = await page.evaluate(() => document.querySelector('[title="Running build"]')?.textContent);
  console.log('build badge after hydrate:', badge || '(none yet)');
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
