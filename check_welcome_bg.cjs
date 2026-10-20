const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const r = await page.evaluate(() => {
    const layers = [...document.querySelectorAll('div')].filter(d => {
      const s = getComputedStyle(d);
      return s.backgroundImage && s.backgroundImage.includes('storage');
    });
    return {
      url: location.href,
      bgLayers: layers.map(d => {
        const r = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        const parent = d.parentElement;
        const pcs = parent ? getComputedStyle(parent) : null;
        return {
          cls: d.className,
          zIndex: cs.zIndex,
          position: cs.position,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          bgImage: cs.backgroundImage.slice(0, 90),
          opacity: cs.opacity,
          parentCls: parent?.className?.slice(0, 90),
          parentZ: pcs?.zIndex,
          parentIsolation: pcs?.isolation,
          parentBg: pcs?.backgroundColor,
        };
      }),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
