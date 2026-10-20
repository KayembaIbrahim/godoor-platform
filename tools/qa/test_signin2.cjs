const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,90)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // click the page-body Sign in CTA (the second one) - it's a full-width button
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, ph: i.placeholder, id: i.id }));
    return { inputs, dialogs: document.querySelectorAll('[role=dialog]').length };
  });
  console.log('after CTA click ->', JSON.stringify(state));
  const em = page.locator('input[type=email]').first();
  const pw = page.locator('input[type=password]').first();
  if (await em.count() && await pw.count()) {
    await em.fill('verifymap+test@example.com');
    await pw.fill('TestPass123');
    const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean));
    console.log('buttons:', JSON.stringify(btns));
    await page.locator('button:has-text("Sign in")').last().click();
    await page.waitForTimeout(6000);
    console.log('URL after submit:', page.url());
    const t = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,200));
    console.log('body:', t);
    console.log('errors:', errs);
    const hasSession = await page.evaluate(() => !!localStorage.getItem('godoor-session'));
    console.log('godoor-session in localStorage:', hasSession);
  }
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
