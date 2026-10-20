const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // Grab the server HTML BEFORE any JS runs
  const serverHtml = await (await fetch('https://godoor.site/')).text();
  require('fs').writeFileSync('/tmp/server_home.html', serverHtml);

  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const clientHtml = await page.evaluate(() => document.getElementById('__next')?.outerHTML || document.body.innerHTML);
  require('fs').writeFileSync('/tmp/client_home.html', clientHtml);
  console.log('server bytes', serverHtml.length, 'client bytes', clientHtml.length);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
