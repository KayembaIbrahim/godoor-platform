const { chromium } = require('playwright');
const ORDER = 'aaaa1111-bbbb-cccc-dddd-eeeeffff0001';
(async () => {
  const b = await chromium.launch({ args:['--enable-unsafe-swiftshader','--use-gl=swiftshader','--disable-dev-shm-usage','--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0,60)));

  await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('button:has-text("Sign in")').nth(1).click();
  await page.waitForTimeout(1200);
  await page.locator('input[type=email]').first().fill('verifymap+test@example.com');
  await page.locator('input[type=password]').first().fill('TestPass123');
  await page.locator('button:has-text("Sign in")').last().click();
  await page.waitForTimeout(5000);

  // --- 1. avatar present after hydration (signed-in state survives) ---
  const headerState = await page.evaluate(() => {
    const h = document.querySelector('header');
    const items = [...h.querySelectorAll('button, a')].map(el => {
      const r = el.getBoundingClientRect();
      return { l: (el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,18), x: Math.round(r.x), w: Math.round(r.width) };
    });
    return { items, hasAvatar: !!h.querySelector('[aria-label="Account menu"]'), badge: h.querySelector('[title="Running build"]')?.textContent || null };
  });
  console.log('=== HEADER (signed in, /app) ===');
  console.log('  account menu (avatar) present:', headerState.hasAvatar, '| build badge:', headerState.badge);
  headerState.items.forEach((i,idx)=>console.log(`   ${i.l}: x=${i.x} w=${i.w}${idx? ' gap='+(i.x-(headerState.items[idx-1].x+headerState.items[idx-1].w)) : ''}`));

  // --- 2. map markers anchored ---
  await page.goto(`https://godoor.site/tracking?orderId=${ORDER}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  const m = await page.evaluate(() => {
    const mapEl = document.querySelector('.mapboxgl-map');
    if (!mapEl) return { err: 'no map' };
    const mr = mapEl.getBoundingClientRect();
    return [...document.querySelectorAll('.mapboxgl-marker')].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const mt = (el.style.transform||'').match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)/);
      if (!mt) return { note: 'no transform', html: el.outerHTML.slice(0,80) };
      const px = parseFloat(mt[1]), py = parseFloat(mt[2]);
      const ax = parseFloat(mt[3])/100, ay = parseFloat(mt[4])/100;
      // expected top-left of the element, from Mapbox's own transform
      const expLeft = px - ax*r.width, expTop = py - ay*r.height;
      const gotLeft = r.x - mr.x, gotTop = r.y - mr.y;
      return {
        size: Math.round(r.width)+'x'+Math.round(r.height),
        position: cs.position, anim: cs.animationName,
        anchor: ax===-0.5 && ay===-0.5 ? 'center' : (ay===-1 ? 'bottom' : 'other'),
        coord: {x:Math.round(px), y:Math.round(py)},
        drawn: {x:Math.round(gotLeft), y:Math.round(gotTop)},
        expected: {x:Math.round(expLeft), y:Math.round(expTop)},
        offsetPx: +Math.hypot(gotLeft-expLeft, gotTop-expTop).toFixed(1),
      };
    });
  });
  console.log('\n=== MAP MARKERS (live, real order) ===');
  if (m.err) { console.log(m.err); } else {
    m.forEach((x,i)=>{
      if (x.note) { console.log(`  #${i} ${x.note}`); return; }
      const ok = x.offsetPx <= 1.5 ? 'ANCHORED' : 'OFF BY ' + x.offsetPx + 'px';
      console.log(`  #${i} ${x.size} anchor=${x.anchor} pos=${x.position} anim=${x.anim} -> ${ok}`);
      console.log(`      coord=${JSON.stringify(x.coord)} expectedTopLeft=${JSON.stringify(x.expected)} drawnTopLeft=${JSON.stringify(x.drawn)}`);
    });
  }
  console.log('\npage errors:', errs.length ? errs : 'NONE');
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
