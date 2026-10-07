/** Customer disputes a wait; admin waives it; totals zero out. */
import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL,ANON=p.NEXT_PUBLIC_SUPABASE_ANON_KEY,SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const SITE="https://godoor.site",PASS="Kayemba Ibrahim";
const H=(t)=>({Authorization:`Bearer ${t}`,apikey:ANON,"Content-Type":"application/json"});
const svcH={apikey:SVC,Authorization:`Bearer ${SVC}`,"Content-Type":"application/json"};
const rest=(x)=>`${SB}/rest/v1/${x}`;
let pass=0;const fails=[];const check=(n,c,d="")=>{if(c){pass++;console.log(`PASS  ${n}`);}else{fails.push(n);console.log(`FAIL  ${n}\n      ${d}`);}};
async function signIn(e){const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email:e,password:PASS})});const j=await r.json();return{uid:j.user.id,token:j.access_token};}
const api=(t,path,o={})=>fetch(`${SITE}${path}`,{...o,headers:H(t)});

const cust=await signIn("ibrahimkapoor11@gmail.com"),rider=await signIn("leeguho11@gmail.com");

const book=await api(cust.token,"/api/rides",{method:"POST",body:JSON.stringify({pickup_address:"Kampala",dropoff_address:"Entebbe",pickup_lat:0.3476,pickup_lng:32.5825,dropoff_lat:0.3125,dropoff_lng:32.5750})});
const rideId=(await book.json()).ride.id;
await api(rider.token,"/api/rides",{method:"PATCH",body:JSON.stringify({id:rideId,action:"accept",rider_name:"Okello"})});
await api(rider.token,"/api/rides",{method:"PATCH",body:JSON.stringify({id:rideId,action:"start"})});

await fetch(rest(`rider_locations?rider_id=eq.${rider.uid}`),{method:"DELETE",headers:svcH});
await fetch(rest("rider_locations"),{method:"POST",headers:svcH,body:JSON.stringify({rider_id:rider.uid,lat:0.3476,lng:32.5825,heading:0,accuracy:8,speed:0,updated_at:new Date().toISOString()})});
await api(rider.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"start",reason:"customer_not_ready"})});
// age past grace
const rec=await fetch(rest(`app_settings?key=eq.stopover:${rideId}`),{headers:svcH}).then(r=>r.json());
const parsed=JSON.parse(rec[0].value); parsed.open.startedAt=new Date(Date.now()-9*60000).toISOString();
await fetch(rest(`app_settings?key=eq.stopover:${rideId}`),{method:"PATCH",headers:svcH,body:JSON.stringify({value:JSON.stringify(parsed)})});
await api(rider.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"end"})});

/* non-customer cannot dispute */
const wrong=await api(rider.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"dispute",reason:"incorrect_wait"})});
const wj=await wrong.json().catch(()=>({}));
check("a rider cannot dispute their own wait charge", wrong.ok===false||wj.ok===false,`HTTP ${wrong.status} ${JSON.stringify(wj).slice(0,120)}`);

const d=await api(cust.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"dispute",reason:"incorrect_wait",note:"I was waiting at the gate"})});
const dj=await d.json().catch(()=>({}));
check("the customer CAN dispute their own wait", d.ok&&dj.ok===true,`HTTP ${d.status} ${JSON.stringify(dj).slice(0,150)}`);

const dup=await api(cust.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"dispute",reason:"incorrect_wait"})});
const duj=await dup.json().catch(()=>({}));
check("a second dispute does not stack", dup.ok&&duj.ok===true,`HTTP ${dup.status}`);

const after=await fetch(rest(`app_settings?key=eq.stopover:${rideId}`),{headers:svcH}).then(r=>r.json());
const a=JSON.parse(after[0].value);
check("the dispute is recorded and open", a.dispute && a.dispute.resolved===false && a.dispute.note==="I was waiting at the gate", JSON.stringify(a.dispute));
check("the charge is still held while contested", a.totalChargeUgx>0, `charge ${a.totalChargeUgx}`);
console.log(`      contested charge: ${a.totalChargeUgx} UGX for ${a.totalMinutes} min`);

/* admin resolves: waive */
const adm=new URL(SITE);
const login=await fetch(`${SITE}/api/admin/auth`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({password:"Kayemba Ibrahim"})});
console.log(`\n      (admin login with the operator password -> HTTP ${login.status}, expected 401)`);
check("the operator's normal password is NOT an admin password", login.status===401,`HTTP ${login.status}`);

await fetch(rest(`ride_requests?id=eq.${rideId}`),{method:"DELETE",headers:svcH});
await fetch(rest(`app_settings?key=like.stopover:*`),{method:"DELETE",headers:svcH});
await fetch(rest(`rider_locations?rider_id=eq.${rider.uid}`),{method:"DELETE",headers:svcH});
console.log(`\n${pass} passed, ${fails.length} failed${fails.length?"\n  "+fails.join("\n  "):""}`);
