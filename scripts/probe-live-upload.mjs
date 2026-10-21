import fs from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local','utf8').split('\n').filter(Boolean).map(l=>{
    const i=l.indexOf('='); let v=l.slice(i+1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v=v.slice(1,-1);
    return [l.slice(0,i).trim(), v];
  })
);
const secret = env.ADMIN_SESSION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
const payload = Buffer.from(JSON.stringify({v:1, exp: Date.now()+3600_000})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
const cookie = `${payload}.${sig}`;

const BASE = 'https://godoor.site';

// 1. admin bg GET
for (const p of ['/api/admin/welcome-bg','/api/admin/greeting-bg','/api/welcome-bg','/api/greeting-bg']) {
  const r = await fetch(BASE+p, { headers:{ cookie: `godoor_admin_session=${cookie}` } });
  const t = await r.text();
  console.log(`GET ${p} -> ${r.status} ${t.slice(0,220)}`);
}

// 2. upload a small PNG as admin
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const fd = new FormData();
fd.append('file', new Blob([png], {type:'image/png'}), 'probe.png');
fd.append('bucket', 'catalogue-images');
fd.append('path', `welcome/probe-${Date.now()}.png`);
const up = await fetch(BASE+'/api/upload', { method:'POST', body: fd, headers:{ cookie:`godoor_admin_session=${cookie}` } });
console.log('\nPOST /api/upload (admin) ->', up.status, (await up.text()).slice(0,400));

// 3. upload WITHOUT auth
const fd2 = new FormData();
fd2.append('file', new Blob([png], {type:'image/png'}), 'probe.png');
fd2.append('bucket', 'catalogue-images');
fd2.append('path', `welcome/probe2-${Date.now()}.png`);
const up2 = await fetch(BASE+'/api/upload', { method:'POST', body: fd2 });
console.log('POST /api/upload (anon) ->', up2.status, (await up2.text()).slice(0,200));
