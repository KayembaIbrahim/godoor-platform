const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,90)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Dump the sign-in trigger's outerHTML to find the right selector
  const trig = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button,a')].filter(e => /sign in|log in/i.test(e.textContent||'') || /sign in/i.test(e.getAttribute('aria-label')||''));
    return els.map(e => ({ tag: e.tagName, cls: (e.className||'').slice(0,80), txt: (e.textContent||'').trim().slice(0,30), aria: e.getAttribute('aria-label') }));
  });
  console.log('triggers:', JSON.stringify(trig, null, 1));
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
