const { chromium } = require('playwright');

/**
 * Live end-to-end marker check.
 *
 * Signs in, opens the active order's tracking page, then for every Mapbox
 * marker compares where it is DRAWN with where the map says its coordinate
 * is. We recover the projection from the map's own DOM: the marker element's
 * inline transform is what Mapbox wrote, so we read the translate() out of it
 * and compare it with the marker's rendered rect. A marker is correctly
 * anchored when its own bounding box sits exactly on the translated point.
 */
const ORDER = 'aaaa1111-bbbb-cccc-dddd-eeeeffff0001';

(async () => {
  const b = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu-sandbox'],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 100)));

  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1500);
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(5000);
  console.log('signed in ->', page.url());

  await page.goto(`https://godoor.site/tracking?orderId=${ORDER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15000);

  const res = await page.evaluate(() => {
    const mapEl = document.querySelector('.mapboxgl-map');
    if (!mapEl) return { err: 'no map', text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300) };

    const markers = [...document.querySelectorAll('.mapboxgl-marker')];
    const mapRect = mapEl.getBoundingClientRect();

    return {
      markerCount: markers.length,
      mapRect: { x: Math.round(mapRect.x), y: Math.round(mapRect.y), w: Math.round(mapRect.width), h: Math.round(mapRect.height) },
      markers: markers.map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // Mapbox writes: translate(Xpx, Ypx) translate(-50%,-50%) …
        const inline = el.style.transform || '';
        const m = inline.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
        const px = m ? parseFloat(m[1]) : null;
        const py = m ? parseFloat(m[2]) : null;
        // the marker's own centre, relative to the map container
        const cx = r.x + r.width / 2 - mapRect.x;
        const cy = r.y + r.height / 2 - mapRect.y;
        return {
          size: Math.round(r.width) + 'x' + Math.round(r.height),
          position: cs.position,
          animName: cs.animationName,
          inlineTransform: inline.slice(0, 60),
          // where Mapbox says the coordinate is, in map-container pixels
          mapboxPoint: px === null ? null : { x: Math.round(px), y: Math.round(py) },
          // where the marker is actually drawn, in map-container pixels
          drawnAt: { x: Math.round(cx), y: Math.round(cy) },
          // how far off it is
          offsetPx: px === null ? null : Math.round(Math.hypot(cx - px, cy - py)),
          childCount: el.children.length,
        };
      }),
    };
  });

  console.log(JSON.stringify(res, null, 2));
  console.log('errors:', errs);
  await page.screenshot({ path: 'shot_tracking.png' });
  console.log('screenshot: shot_tracking.png');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
