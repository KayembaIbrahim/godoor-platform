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

for (const b of ['catalogue-images','store-photos','welcome-media','greeting-media']) {
  const { error } = await sb.storage.createBucket(b, { public: true });
  console.log(`createBucket(${b}):`, error ? `ERR ${error.message}` : 'OK');
}
const { data: buckets } = await sb.storage.listBuckets();
console.log('buckets now:', (buckets||[]).map(x=>x.name).join(', '));
