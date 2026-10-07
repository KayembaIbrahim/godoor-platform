import { chromium } from 'playwright';

const EXE = '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const ACCOUNTS = [
  ['RIDER', 'leeguho11@gmail.com'],
  ['CUSTOMER', 'ibrahimkapoor11@gmail.com'],
  ['BUSINESS', 'fediyudi@gmail.com'],
];
const PWS = process.argv.slice(2).length ? process.argv.slice(2) : ['Kayemba Ibrahim', 'Kayemba@256'];

async function run(label, email, pw) {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    const netFail = [];
    page.on('response', (r) => {
      if (r.url().includes('/auth/v1/') && r.status() >= 400) netFail.push(`${r.status()} ${r.url().split('?')[0]}`);
    });
    await page.goto('https://godoor.site/', { waitUntil: 'domcontentloaded', timeout: 45000 });

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,a')].find((e) =>
        /^(sign in|log in)$/i.test((e.textContent || '').trim()));
      b?.click();
    });
    await page.waitForSelector('[role="dialog"] input[type="email"]', { timeout: 20000 });

    await page.fill('[role="dialog"] input[type="email"]', email);
    await page.fill('[role="dialog"] input[type="password"]', pw);

    const h2Before = await page.textContent('[role="dialog"] h2');

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')]
        .find((e) => /^(sign in|create account)$/i.test((e.textContent || '').trim()));
      b?.click();
    });

    // Wait for either navigation or an in-dialog error
    const outcome = await Promise.race([
      page.waitForURL((u) => !u.pathname.match(/^\/$/), { timeout: 20000 }).then(() => 'NAVIGATED'),
      page.waitForSelector('[role="dialog"] .bg-danger\\/10 p', { timeout: 20000 }).then(() => 'ERROR'),
    ]).catch(() => 'TIMEOUT');

    const st = await page.evaluate(() => ({
      url: location.pathname + location.search,
      h2: document.querySelector('[role="dialog"] h2')?.textContent || '',
      err: document.querySelector('[role="dialog"] .bg-danger\\/10 p')?.textContent?.trim() || '',
      hasName: !!document.querySelector('[role="dialog"] input[placeholder="John Doe"]'),
    }));

    console.log(
      `${label.padEnd(9)} ${JSON.stringify(pw).padEnd(19)} ${outcome.padEnd(10)} ` +
      `url=${st.url.padEnd(12)} h2:"${h2Before}->${st.h2}" nameField=${st.hasName ? 'YES' : 'no'} err="${st.err.slice(0, 60)}" ${netFail.join(',')}`
    );
  } catch (e) {
    console.log(`${label.padEnd(9)} ${JSON.stringify(pw).padEnd(19)} TEST ERROR ${e.message.slice(0, 80)}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

for (const pw of PWS) for (const [label, email] of ACCOUNTS) await run(label, email, pw);