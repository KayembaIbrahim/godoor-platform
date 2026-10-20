const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [w, url] of [[390,'https://godoor.site/'],[360,'https://godoor.site/'],[390,'https://godoor.site/app'],[360,'https://godoor.site/app']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return { err: 'no header' };
      const cluster = header.querySelector('div > div');
      const items = [...cluster.querySelectorAll('button, a')].map(b => {
        const r = b.getBoundingClientRect();
        return { l: (b.getAttribute('aria-label')||b.textContent||b.tagName).trim().slice(0,16), x: Math.round(r.x), w: Math.round(r.width) };
      });
      const logo = header.querySelector('a')?.getBoundingClientRect();
      return {
        gap: getComputedStyle(cluster).gap,
        clusterW: Math.round(cluster.getBoundingClientRect().width),
        logoW: logo ? Math.round(logo.width) : null,
        lastRight: items.length ? items[items.length-1].x + items[items.length-1].w : null,
        items,
      };
    });
    console.log(`\n[${w}px] ${url}`);
    console.log('  gap', r.gap, '| cluster', r.clusterW, '| logo', r.logoW, '| last right edge', r.lastRight, '| viewport', w);
    r.items.forEach((i,idx)=>console.log(`   ${i.l}: x=${i.x} w=${i.w}${idx? ' gap=' + (i.x - (r.items[idx-1].x + r.items[idx-1].w)) : ''}`));
    await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
