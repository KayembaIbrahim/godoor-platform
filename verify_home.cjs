const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,120)));
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  console.log('PAGE ERRORS:', errs.length ? errs.join(' | ') : 'NONE');

  // Does the build badge now render on the client?
  const badge = await page.evaluate(() => {
    const s = document.querySelector('[title="Running build"]');
    return s ? s.textContent : null;
  });
  console.log('build badge text:', badge || '(none yet)');

  // Background sampling: the welcome layer spans y=57..844 with z-index -20 inside an isolated parent.
  // A painted photo has varied colors; white background is flat rgb(255,255,255).
  // Sample a horizontal strip through the middle of the welcome area.
  const sample = await page.evaluate(() => {
    const outer = document.querySelector('.mapboxgl-map'); // placeholder
    const bg = document.querySelector('div[class*="bg-cover"], [class*="-z-20"]');
    const cs = getComputedStyle(bg);
    const r = bg.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = 390; canvas.height = Math.round(r.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,390,Math.round(r.height));
    // draw the element's box onto canvas
    const img = new Image();
    img.src = getComputedStyle(document.documentElement).backgroundImage.includes('storage') ? '' : '';
    return { cls: bg?.className, y0: Math.round(r.y), h: Math.round(r.height), hasImage: cs.backgroundImage.includes('storage') };
  });
  console.log('sample:', JSON.stringify(sample));

  // Take a screenshot of just the top portion and compare variance
  await page.screenshot({ path: 'shot_home.png' });
  console.log('screenshot: shot_home.png');
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
