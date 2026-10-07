import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL,SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const H={apikey:SVC,Authorization:`Bearer ${SVC}`};
const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:p.NEXT_PUBLIC_SUPABASE_ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:"leeguho11@gmail.com",password:"Kayemba Ibrahim"})});
const j=await r.json(); const uid=j.user.id;
console.log("rider uid:",uid);
for(const [t,q] of [["riders",`riders?user_id=eq.${uid}`],["riders by email",`riders?email=eq.leeguho11@gmail.com`],["verification_documents",`verification_documents?user_id=eq.${uid}&select=*`],["merchants",`merchants?user_id=eq.${uid}&select=id,name,status,verified`],["profiles",`profiles?user_id=eq.${uid}`]]){
  const x=await fetch(`${SB}/rest/v1/${q}`,{headers:H}); const txt=await x.text();
  let out=txt; try{const d=JSON.parse(txt); out=JSON.stringify(d);}catch{}
  console.log(`\n${t}: ${x.status} ${Array.isArray(JSON.parse(txt||"[]"))?JSON.parse(txt).length+" row(s)":""}\n  ${String(out).slice(0,320)}`);
}
