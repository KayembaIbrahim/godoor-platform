import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local','utf8').split('\n').filter(Boolean).map(l=>{
    const i=l.indexOf('='); let v=l.slice(i+1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1);
    return [l.slice(0,i).trim(), v];
  })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
for (const [bucket, path] of [['catalogue-images',`welcome/probe-${Date.now()}.png`],['catalogue-images',`greeting/probe-${Date.now()}.png`]]) {
  const { error } = await sb.storage.from(bucket).upload(path, png, { contentType:'image/png', upsert:true });
  console.log(`upload ${bucket}/${path}:`, error ? 'ERR '+error.message : 'OK');
  if (!error) {
    const { data } = sb.storage.from(bucket).getPublicUrl(path);
    const res = await fetch(data.publicUrl);
    console.log('  publicUrl:', data.publicUrl);
    console.log('  fetch:', res.status, res.headers.get('content-type'), (await res.arrayBuffer()).byteLength, 'bytes');
  }
}

// Now test a VIDEO-sized upload to see if there is a size ceiling
const big = Buffer.alloc(6*1024*1024, 1);
const { error: vErr } = await sb.storage.from('catalogue-images').upload(`welcome/probe-${Date.now()}.mp4`, big, { contentType:'video/mp4', upsert:true });
console.log('\n6MB video upload:', vErr ? 'ERR '+vErr.message : 'OK');
