const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,160)));
  for (const url of ['https://godoor.site/', 'https://godoor.site/app', 'https://godoor.site/explore', 'https://godoor.site/tracking']) {
    errs.length = 0;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    console.log(url, '->', errs.length ? errs.join(' | ') : 'clean');
  }
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
