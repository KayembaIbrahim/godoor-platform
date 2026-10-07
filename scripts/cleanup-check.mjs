import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL,SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:SVC,Authorization:`Bearer ${SVC}`};
for(const [label,path] of [
 ["test rides","ride_requests?customer_name=eq.Ibrahim&select=id,status,created_at"],
 ["stopover kv rows","app_settings?key=like.stopover:*&select=key"],
 ["probe rows","ride_requests?customer_name=eq.__rt_probe__&select=id"],
 ["rider GPS","rider_locations?select=rider_id,updated_at"]]){
  const r=await fetch(`${SB}/rest/v1/${path}`,{headers:H});
  const d=await r.json().catch(()=>[]);
  console.log(`${label}: ${Array.isArray(d)?d.length+" row(s)":"?"}  ${JSON.stringify(d).slice(0,200)}`);
}
