const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.type()+': '+m.text().slice(0,400)));
  page.on('pageerror', e => logs.push('PAGEERROR: '+e.message.slice(0,300)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  console.log(logs.filter(l=>/error|418|hydrat|WARN/i.test(l)).join('\n---\n').slice(0,3000));
  // find the DOM node React flagged
  const flagged = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.outerHTML.includes('data-reactroot') ) return;
    });
    return out;
  });
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
