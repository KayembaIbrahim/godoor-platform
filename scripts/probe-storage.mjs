import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean).map(l=>{
    const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()];
  })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: buckets, error: berr } = await sb.storage.listBuckets();
console.log('listBuckets error:', berr?.message || 'none');
console.log('buckets:', (buckets||[]).map(b=>`${b.name} (public=${b.public})`).join('\n  '));

// try upload a tiny png into catalogue-images
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const path = `welcome/probe-${Date.now()}.png`;
const { error: uerr } = await sb.storage.from('catalogue-images')
  .upload(path, png, { contentType: 'image/png', upsert: true });
console.log('upload error:', uerr?.message || 'none');
if (!uerr) {
  const { data } = sb.storage.from('catalogue-images').getPublicUrl(path);
  console.log('publicUrl:', data.publicUrl);
  const res = await fetch(data.publicUrl);
  console.log('public fetch status:', res.status, 'len', (await res.arrayBuffer()).byteLength);
}
