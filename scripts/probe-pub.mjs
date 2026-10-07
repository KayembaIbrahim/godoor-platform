import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const r=await fetch(`${SB}/rest/v1/rpc/exec_sql`,{method:"POST",headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,"Content-Type":"application/json"},body:JSON.stringify({sql:"select 1"})});
console.log("rpc/exec_sql ->",r.status,(await r.text()).slice(0,200));
for(const fn of ["exec_sql","execute_sql","run_sql","sql","admin_exec_sql"]){
  const x=await fetch(`${SB}/rest/v1/rpc/${fn}`,{method:"POST",headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,"Content-Type":"application/json"},body:JSON.stringify({sql:"select 1",query:"select 1"})});
  console.log(`  rpc/${fn} -> ${x.status}`);
}
