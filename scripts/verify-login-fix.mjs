import { chromium } from 'playwright';

const EXE = '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const PW = 'Kayemba@256';
const CASES = [
  ['RIDER', 'leeguho11@gmail.com', PW, '/rider'],
  ['CUSTOMER', 'ibrahimkapoor11@gmail.com', PW, '/app'],
  ['BUSINESS', 'fediyudi@gmail.com', PW, '/business'],
  ['WRONGPW', 'ibrahimkapoor11@gmail.com', 'definitely-not-it', null],
  ['MIXEDCASE+SPACE', '  IbrahimKapoor11@Gmail.com  ', PW, '/app'],
];

const ONLY = process.argv[2];
for (const [label, email, pw, expectPath] of CASES.filter(([l]) => !ONLY || l === ONLY)) {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate(() => {
      [...document.querySelectorAll('button,a')]
        .find((e) => /^(sign in|log in)$/i.test((e.textContent || '').trim()))?.click();
    });
    await page.waitForSelector('[role="dialog"] input[type="email"]', { timeout: 20000 });
    await page.fill('[role="dialog"] input[type="email"]', email);
    await page.fill('[role="dialog"] input[type="password"]', pw);
    await page.evaluate(() => {
      [...document.querySelectorAll('[role="dialog"] button')]
        .find((e) => /^(sign in|create account)$/i.test((e.textContent || '').trim()))?.click();
    });

    const st = await Promise.race([
      page.waitForURL((u) => !u.pathname.match(/^\/$/), { timeout: 20000 })
        .then(() => page.evaluate(() => ({ url: location.pathname }))),
      page.waitForSelector('[role="dialog"] .bg-danger\\/10 p', { timeout: 20000 })
        .then(() => page.evaluate(() => ({
          url: location.pathname,
          err: document.querySelector('[role="dialog"] .bg-danger\\/10 p')?.textContent?.trim() || '',
          h2: document.querySelector('[role="dialog"] h2')?.textContent || '',
          nameField: !!document.querySelector('[role="dialog"] input[placeholder="John Doe"]'),
          btn: [...document.querySelectorAll('[role="dialog"] button')].map(b => (b.textContent||'').trim()).find(t => /sign in|create account/i.test(t)) || '',
        }))),
    ]).catch(() => ({ url: '(timeout)' }));

    if (expectPath) {
      const pass = st.url === expectPath;
      console.log(`${label.padEnd(16)} ${pass ? 'PASS' : 'FAIL'}  landed=${st.url} expected=${expectPath}`);
    } else {
      const stayed = st.h2 === 'Welcome back' && !st.nameField && /sign in/i.test(st.btn);
      console.log(`${label.padEnd(16)} ${stayed ? 'PASS' : 'FAIL'}  msg="${(st.err||'').slice(0,52)}" h2="${st.h2}" nameField=${st.nameField} btn="${st.btn}"`);
    }
  } catch (e) {
    console.log(`${label.padEnd(16)} ERROR  ${e.message.slice(0, 70)}`);
  } finally {
    await browser.close().catch(() => {});
  }
}