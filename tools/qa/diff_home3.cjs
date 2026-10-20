const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--disable-dev-shm-usage','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1200);
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(6000);
  const serverHtml = await page.evaluate(async () => (await fetch('/', {credentials:'include'})).text());
  require('fs').writeFileSync('/tmp/s_home.html', serverHtml);
  await page.goto('https://godoor.site/', { waitUntil: 'load' });
  await page.waitForTimeout(12000);
  const clientHtml = await page.evaluate(() => {
    const n = document.getElementById('__next');
    return n ? n.innerHTML : document.body.innerHTML;
  });
  require('fs').writeFileSync('/tmp/c_home.html', clientHtml);
  console.log('server', serverHtml.length, 'client', clientHtml.length);
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
