import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL,SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:SVC,Authorization:`Bearer ${SVC}`};
// Only the rides this debugging session created (address empty => synthetic probe).
const r=await fetch(`${SB}/rest/v1/ride_requests?id=eq.98cf324e-731f-4f03-9ccb-0e4ff413ae55`,{method:"DELETE",headers:H});
console.log("purge session probe ride ->",r.status);
const g=await fetch(`${SB}/rest/v1/ride_requests?select=id,customer_name,status,pickup_address`,{headers:H});
console.log("remaining rides:",JSON.stringify(await g.json()).slice(0,400));
