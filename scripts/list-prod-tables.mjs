import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, SVC=p.SUPABASE_SERVICE_ROLE_KEY;
// OpenAPI spec lists every exposed table
const r=await fetch(`${SB}/rest/v1/`,{headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,Accept:"application/openapi+json"}});
const spec=await r.json().catch(()=>({}));
const tables=Object.keys(spec.paths||{}).map(x=>x.split("/")[1]).filter(x=>x&&!x.startsWith("rpc/"));
console.log("tables exposed in PRODUCTION ("+tables.length+"):");
console.log(tables.sort().join(", "));
console.log("\nrelevant:",["ride_requests","ride_stopovers","ride_stopover_disputes","fare_rates","riders","orders","app_settings","user_wallets"].map(t=>`${t}=${tables.includes(t)}`).join("  "));
