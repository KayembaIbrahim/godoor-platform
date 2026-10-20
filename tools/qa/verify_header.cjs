const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  const target = process.argv[2] || 'https://godoor.site/app';
  console.log('=== ' + target + ' ===');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // ---- HEADER CLUSTER ----
  const info = await page.evaluate(() => {
    const header = document.querySelector('header');
    if (!header) return { err: 'no header' };
    const row = header.querySelector('div');
    const cluster = header.querySelector('div > div');
    if (!cluster) return { err: 'no cluster' };
    const btns = [...cluster.querySelectorAll('button, a')].map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: b.getAttribute('aria-label') || b.textContent?.trim().slice(0, 18) || b.tagName,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    const cs = getComputedStyle(cluster);
    const rowCs = getComputedStyle(row);
    const logo = header.querySelector('a');
    const logoRect = logo?.getBoundingClientRect();
    return {
      clusterGap: cs.gap,
      clusterWidth: Math.round(cluster.getBoundingClientRect().width),
      rowPadding: rowCs.paddingLeft + ' / ' + rowCs.paddingRight,
      rowGap: rowCs.gap,
      logoWidth: logoRect ? Math.round(logoRect.width) : null,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      buttons: btns,
      viewport: window.innerWidth,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // gaps between adjacent buttons
  if (info.buttons && info.buttons.length > 1) {
    console.log('--- actual pixel gaps between controls ---');
    for (let i = 1; i < info.buttons.length; i++) {
      const g = info.buttons[i].x - (info.buttons[i - 1].x + info.buttons[i - 1].w);
      console.log(`  ${info.buttons[i - 1].label} -> ${info.buttons[i].label}: ${g}px`);
    }
  }

  await page.screenshot({ path: '/tmp/shot_header.png', clip: { x: 0, y: 0, width: 390, height: 120 } });
  console.log('screenshot: /tmp/shot_header.png');

  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
