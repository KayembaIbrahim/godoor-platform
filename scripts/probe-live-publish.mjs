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
const cookie = `godoor_admin_session=${payload}.${crypto.createHmac('sha256',secret).update(payload).digest('hex')}`;
const BASE='https://godoor.site';

// upload an image
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const fd = new FormData();
fd.append('file', new Blob([png],{type:'image/png'}), 'probe.png');
fd.append('bucket','catalogue-images');
fd.append('path',`greeting/probe-${Date.now()}.png`);
const up = await fetch(BASE+'/api/upload',{method:'POST',body:fd,headers:{cookie}});
const { url } = await up.json();
console.log('uploaded url:', url);

// PUT greeting-bg publish
const put = await fetch(BASE+'/api/admin/greeting-bg',{
  method:'PUT', headers:{cookie,'Content-Type':'application/json'},
  body: JSON.stringify({ imageUrl:url, intensity:100, published:true, isGif:false, mediaType:'image' })
});
console.log('PUT greeting-bg ->', put.status, (await put.text()).slice(0,300));

// PUT welcome-bg with a video slide
const put2 = await fetch(BASE+'/api/admin/welcome-bg',{
  method:'PUT', headers:{cookie,'Content-Type':'application/json'},
  body: JSON.stringify({ imageUrl:'', intensity:100, published:true, slides:[{id:'s1',type:'video',url:'https://example.com/clip.mp4',durationMs:5000}], slideDurationMs:6000 })
});
console.log('PUT welcome-bg (video slide) ->', put2.status, (await put2.text()).slice(0,300));

// read back public
for (const p of ['/api/welcome-bg','/api/greeting-bg']) {
  const r = await fetch(BASE+p);
  console.log('GET',p,'->',r.status,(await r.text()).slice(0,300));
}
