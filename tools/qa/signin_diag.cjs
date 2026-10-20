const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--disable-dev-shm-usage','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,80)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const n = await page.locator('button:has-text("Sign in")').count();
  console.log('sign-in buttons on homepage:', n);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1500);
  console.log('dialog inputs:', await page.locator('input').count());
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(7000);
  console.log('URL:', page.url());
  const st = await page.evaluate(() => ({
    session: !!localStorage.getItem('godoor-session'),
    sessionRaw: (localStorage.getItem('godoor-session')||'').slice(0,220),
    avatar: !!document.querySelector('[aria-label="Account menu"]'),
    signInBtn: [...document.querySelectorAll('button')].some(b => /sign in/i.test(b.textContent||'')),
    avatarHtml: document.querySelector('[aria-label="Account menu"]')?.innerHTML.slice(0,150) || null,
  }));
  console.log(JSON.stringify(st, null, 1));
  console.log('errors:', errs);
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
