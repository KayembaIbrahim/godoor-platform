import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const r=await fetch(`${SB}/rest/v1/`,{headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,Accept:"application/openapi+json"}});
const spec=await r.json();
const defs=spec.definitions||spec.components?.schemas||{};
for(const t of ["ride_requests","app_settings","admin_settings","rider_locations","riders"]){
  const d=defs[t];
  if(!d){console.log(`${t}: NOT in spec`);continue;}
  const cols=Object.keys(d.properties||{});
  console.log(`\n${t} (${cols.length}): ${cols.join(", ")}`);
}
