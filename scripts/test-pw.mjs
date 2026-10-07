import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.vercel-prod', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log('project:', new URL(url).hostname);

const ACCOUNTS = [
  ['RIDER', 'leeguho11@gmail.com'],
  ['CUSTOMER', 'ibrahimkapoor11@gmail.com'],
  ['BUSINESS', 'fediyudi@gmail.com'],
];
const PASSWORDS = ['Kayemba@256', 'Kayemba Ibrahim'];

for (const [label, email] of ACCOUNTS) {
  for (const pw of PASSWORDS) {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    const j = await r.json().catch(() => ({}));
    const verdict =
      r.ok && j.access_token
        ? `OK   email=${j.user?.email} verified=${j.user?.email_confirmed_at ? 'yes' : 'no'}`
        : `FAIL ${r.status} ${j.error_description || j.msg || j.error || JSON.stringify(j).slice(0, 120)}`;
    console.log(`${label.padEnd(9)} ${pw.padEnd(17)} -> ${verdict}`);
  }
}