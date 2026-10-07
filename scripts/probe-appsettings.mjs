import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:SVC,Authorization:`Bearer ${SVC}`,"Content-Type":"application/json",Prefer:"return=representation"};
const K="__probe_stopover_test__";
// 1) insert
let r=await fetch(`${SB}/rest/v1/app_settings`,{method:"POST",headers:{...H,Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({key:K,value:JSON.stringify({n:1})})});
console.log("upsert #1 ->",r.status,(await r.text()).slice(0,200));
// 2) duplicate insert must FAIL (proves unique key)
let d=await fetch(`${SB}/rest/v1/app_settings`,{method:"POST",headers:H,body:JSON.stringify({key:K,value:JSON.stringify({n:2})})});
console.log("plain INSERT same key ->",d.status,(await d.text()).slice(0,220));
// 3) read back
let g=await fetch(`${SB}/rest/v1/app_settings?key=eq.${K}`,{headers:{apikey:SVC,Authorization:`Bearer ${SVC}`}});
console.log("read ->",g.status,JSON.stringify(await g.json()).slice(0,200));
// 4) delete
let x=await fetch(`${SB}/rest/v1/app_settings?key=eq.${K}`,{method:"DELETE",headers:{apikey:SVC,Authorization:`Bearer ${SVC}`}});
console.log("cleanup ->",x.status);
