import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local','utf8').split('\n').filter(Boolean).map(l=>{
    const i=l.indexOf('='); let v=l.slice(i+1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1);
    return [l.slice(0,i).trim(), v];
  })
);
console.log('prod url:', env.NEXT_PUBLIC_SUPABASE_URL);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: buckets, error: berr } = await sb.storage.listBuckets();
console.log('listBuckets error:', berr?.message || 'none');
console.log('buckets:', (buckets||[]).map(b=>`${b.name} (public=${b.public})`).join('\n  ') || '(NONE)');

// app_settings row for the two keys
for (const key of ['welcome-background:v1','greeting-background:v1']) {
  const { data, error } = await sb.from('app_settings').select('key,value,updated_at').eq('key', key).maybeSingle();
  console.log(`\napp_settings[${key}]:`, error ? 'ERR '+error.message : JSON.stringify(data));
}
