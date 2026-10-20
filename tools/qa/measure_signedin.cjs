const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const w of [390, 360]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const si = page.locator('[aria-label="Sign in"]').first();
    if (await si.count()) { await si.click(); await page.waitForTimeout(1200); }
    const em = page.locator('input[type=email], input[name=email]').first();
    const pw = page.locator('input[type=password], input[name=password]').first();
    if (await em.count() && await pw.count()) {
      await em.fill('verifymap+test@example.com');
      await pw.fill('TestPass123');
      await page.locator('button[type=submit]').last().click();
      await page.waitForTimeout(5000);
    }
    await page.goto('https://godoor.site/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    const r = await page.evaluate(() => {
      const header = document.querySelector('header');
      const cluster = header.querySelector('div > div');
      const items = [...cluster.querySelectorAll('button, a')].map(el => {
        const r = el.getBoundingClientRect();
        return { l: (el.getAttribute('aria-label')||el.textContent||el.tagName).trim().slice(0,16), x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const logo = header.querySelector('a')?.getBoundingClientRect();
      const row = header.querySelector('div')?.getBoundingClientRect();
      return { gap: getComputedStyle(cluster).gap, clusterW: Math.round(cluster.getBoundingClientRect().width),
               logoW: logo?Math.round(logo.width):null, rowW: row?Math.round(row.width):null, items };
    });
    console.log(`\n[${w}px SIGNED IN]`);
    console.log('  gap', r.gap, '| cluster', r.clusterW, '| logo', r.logoW, '| row', r.rowW);
    r.items.forEach((i,idx)=>console.log(`   ${i.l}: x=${i.x} w=${i.w} h=${i.h}${idx? ' gap=' + (i.x - (r.items[idx-1].x + r.items[idx-1].w)) : ''}`));
    const last = r.items[r.items.length-1];
    console.log('   => right edge', last.x + last.w, 'of', w, '(slack', w - (last.x+last.w), 'px)');
    await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
