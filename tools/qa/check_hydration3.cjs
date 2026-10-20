const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.type() + ' | ' + m.text().slice(0, 500)));
  page.on('pageerror', e => logs.push('PAGEERROR | ' + e.message.slice(0, 300)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  console.log('=== ALL CONSOLE ===');
  logs.forEach(l => console.log(l));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
