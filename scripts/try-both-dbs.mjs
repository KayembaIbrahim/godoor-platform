import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const local=parse(".env.local"), prod=parse(".env.vercel-prod");
const DBS={dev:{url:local.NEXT_PUBLIC_SUPABASE_URL,anon:local.NEXT_PUBLIC_SUPABASE_ANON_KEY,svc:local.SUPABASE_SERVICE_ROLE_KEY},prod:{url:prod.NEXT_PUBLIC_SUPABASE_URL,anon:prod.NEXT_PUBLIC_SUPABASE_ANON_KEY,svc:prod.SUPABASE_SERVICE_ROLE_KEY}};
const MAILS={rider:"leeguho11@gmail.com",customer:"ibrahimkapoor11@gmail.com",business:"fediyudi@gmail.com"};
const PASSES=["Kayemba@256","Kayemba Ibrahim","Kayembab256","kayemba@256","Kayemba256"];
for(const [dn,d] of Object.entries(DBS)){
  if(!d.url||!d.anon){console.log(`${dn}: incomplete env`);continue;}
  console.log(`\n=== ${dn}  ${d.url.replace("https://","").split(".")[0]} ===`);
  for(const [role,mail] of Object.entries(MAILS)){
    // does the auth user exist?
    let uid=null,exists=false;
    const s=await fetch(`${d.url}/auth/v1/admin/users`,{headers:{apikey:d.svc,Authorization:`Bearer ${d.svc}`}});
    if(s.ok){const list=await s.json().catch(()=>[]);const u=(list.users||[]).find(u=>u.email===mail);if(u){exists=true;uid=u.id;}}
    let okPw=null;
    for(const p of PASSES){
      const r=await fetch(`${d.url}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:d.anon,"Content-Type":"application/json"},body:JSON.stringify({email:mail,password:p})});
      if(r.ok){okPw=p;break;}
    }
    console.log(`  ${role.padEnd(9)} ${mail}  exists=${exists}  uid=${uid?uid.slice(0,8):"—"}  pwOK=${okPw?JSON.stringify(okPw):"NONE of "+PASSES.length+" tried"}`);
  }
}
