import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.vercel-prod', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: ANON, 'Content-Type': 'application/json' };

const ACCOUNTS = [
  ['RIDER', 'leeguho11@gmail.com'],
  ['CUSTOMER', 'ibrahimkapoor11@gmail.com'],
  ['BUSINESS', 'fediyudi@gmail.com'],
];
const CURRENT = 'Kayemba Ibrahim';
const NEW_PW = 'Kayemba@256';

for (const [label, email] of ACCOUNTS) {
  const s = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: H, body: JSON.stringify({ email, password: CURRENT }),
  });
  const sj = await s.json();
  if (!s.ok || !sj.access_token) { console.log(`${label.padEnd(9)} SIGN-IN FAILED ${s.status} ${sj.error_description || sj.msg}`); continue; }

  // Change own password using the signed-in JWT — proves ownership, no service key.
  const u = await fetch(`${URL_}/auth/v1/user`, {
    method: 'PUT',
    headers: { ...H, Authorization: `Bearer ${sj.access_token}` },
    body: JSON.stringify({ password: NEW_PW }),
  });
  const uj = await u.json().catch(() => ({}));
  console.log(`${label.padEnd(9)} set-password ${u.ok ? 'OK' : `FAIL ${u.status} ${uj.error_description || uj.msg || uj.error}`}`);
}

// Re-verify from scratch with the new password only.
console.log('--- verification with the new password ---');
for (const [label, email] of ACCOUNTS) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: H, body: JSON.stringify({ email, password: NEW_PW }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`${label.padEnd(9)} ${JSON.stringify(NEW_PW).padEnd(15)} -> ${r.ok && j.access_token ? 'OK' : `FAIL ${r.status} ${j.error_description || j.msg}`}`);
}