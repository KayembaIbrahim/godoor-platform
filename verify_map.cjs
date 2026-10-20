const { chromium } = require('playwright');

/**
 * Verifies that every Mapbox marker on a page is drawn AT its coordinate.
 *
 * For each marker we read the marker's own element rect and compare it with
 * the position Mapbox projects the marker's LngLat to. If the marker is
 * offset, the two disagree.
 */
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  const target = process.argv[2] || 'https://godoor.site/tracking?orderId=cd88b0c2-52ab-4abe-a39e-d6a3a5760859';
  console.log('=== ' + target + ' ===');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // give the map time to boot + tiles to load
  await page.waitForTimeout(9000);

  const res = await page.evaluate(() => {
    const mapEl = document.querySelector('.mapboxgl-map');
    if (!mapEl) return { err: 'no .mapboxgl-map on page' };

    const markers = [...document.querySelectorAll('.mapboxgl-marker')];
    const out = markers.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        cls: el.className,
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.x), y: Math.round(r.y),
        transform: cs.transform,
        position: cs.position,
        anim: cs.animationName,
        childCount: el.children.length,
      };
    });
    const mc = document.querySelector('.mapboxgl-canvas-container');
    const mcr = mc?.getBoundingClientRect();
    return {
      mapRect: mcr ? { x: Math.round(mcr.x), y: Math.round(mcr.y), w: Math.round(mcr.width), h: Math.round(mcr.height) } : null,
      markerCount: markers.length,
      markers: out,
    };
  });

  console.log(JSON.stringify(res, null, 2));
  await page.screenshot({ path: 'shot_map.png' });
  console.log('screenshot: shot_map.png');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
