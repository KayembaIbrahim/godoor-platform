const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 500, height: 400 } });
  await p.goto('file://' + path.resolve(__dirname, 'marker_test.html'));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const out = {};
    for (const id of ['old','new','oldDot','newDot']) {
      const el = document.getElementById(id);
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[id] = {
        x: Math.round(b.x), y: Math.round(b.y),
        w: Math.round(b.width), h: Math.round(b.height),
        position: cs.position,
        animName: cs.animationName,
        computedTransform: cs.transform,
        opacity: cs.opacity,
      };
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  console.log('\nEXPECTED: every marker centred at (120, 80) => x = 120-22 = 98, y = 80-22 = 58');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
