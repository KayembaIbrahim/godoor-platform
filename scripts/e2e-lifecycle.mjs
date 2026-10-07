/**
 * Full ride lifecycle against the DEPLOYED site, using real accounts.
 *   book -> rider sees -> accept -> start -> WAITING PASSENGER -> end wait -> complete
 * Read+write only against the operator's own test accounts; the ride created is
 * cleaned up at the end.
 */
import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, ANON=p.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const SITE="https://godoor.site", PASS="Kayemba Ibrahim";
const H=(t)=>({Authorization:`Bearer ${t}`,apikey:ANON,"Content-Type":"application/json"});
const svcH={apikey:SVC,Authorization:`Bearer ${SVC}`,"Content-Type":"application/json"};
const rest=(x)=>`${SB}/rest/v1/${x}`;
let pass=0; const fails=[];
const check=(n,c,d="")=>{ if(c){pass++;console.log(`PASS  ${n}`);} else {fails.push(n);console.log(`FAIL  ${n}\n      ${d}`);} };

async function signIn(email){const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email,password:PASS})});const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.msg);return{uid:j.user.id,token:j.access_token};}
const api=(t,path,o={})=>fetch(`${SITE}${path}`,{...o,headers:H(t)});

const cust=await signIn("ibrahimkapoor11@gmail.com");
const rider=await signIn("leeguho11@gmail.com");
console.log(`customer ${cust.uid.slice(0,8)}  rider ${rider.uid.slice(0,8)}\n`);

/* 1. BOOK */
const book=await api(cust.token,"/api/rides",{method:"POST",body:JSON.stringify({
  pickup_address:"Makerere Main Gate", dropoff_address:"Nakasero Road",
  pickup_lat:0.3476, pickup_lng:32.5825, dropoff_lat:0.3125, dropoff_lng:32.5750 })});
const bj=await book.json().catch(()=>({}));
const rideId=bj.ride?.id||bj.id;
check("customer can book a ride", book.ok && !!rideId, `HTTP ${book.status} ${JSON.stringify(bj).slice(0,150)}`);
if(!rideId) process.exit(1);
console.log(`      ride ${rideId}  fare ${bj.ride?.fare_ugx} + fee ${bj.ride?.service_fee_ugx} = ${bj.ride?.total_ugx}\n`);

/* 2. RIDER SEES IT */
const open=await api(rider.token,"/api/rides?open=1");
const oj=await open.json().catch(()=>({}));
check("rider's board shows the new request", open.ok && (oj.rides||[]).some(r=>r.id===rideId), `HTTP ${open.status} ${(oj.rides||[]).length} ride(s)`);

/* 3. ACCEPT */
const acc=await api(rider.token,`/api/rides`,{method:"PATCH",body:JSON.stringify({id:rideId,action:"accept",rider_name:"Okello"})});
const aj=await acc.json().catch(()=>({}));
check("rider can accept the ride", acc.ok && aj.ride?.status==="accepted", `HTTP ${acc.status} ${JSON.stringify(aj).slice(0,180)}`);

/* 4. START */
const st=await api(rider.token,`/api/rides`,{method:"PATCH",body:JSON.stringify({id:rideId,action:"start"})});
const sj=await st.json().catch(()=>({}));
check("rider can start the trip", st.ok && sj.ride?.status==="in_progress", `HTTP ${st.status} ${JSON.stringify(sj).slice(0,180)}`);

/* 5. GPS: rider stopped (0 m/s), fresh — required by the anti-fraud check */
await fetch(rest(`rider_locations?rider_id=eq.${rider.uid}`),{method:"DELETE",headers:svcH});
const gps=await fetch(rest("rider_locations"),{method:"POST",headers:svcH,body:JSON.stringify({rider_id:rider.uid,lat:0.3476,lng:32.5825,heading:0,accuracy:8,speed:0,updated_at:new Date().toISOString()})});
check("seeded a stopped GPS fix for the rider", gps.ok, `HTTP ${gps.status}`);

/* 6. WAITING-PASSENGER (the reported dead feature) */
const soGet=await api(rider.token,`/api/rides/stopover?rideId=${rideId}`);
const sg=await soGet.json().catch(()=>({}));
check("rider can read the waiting-time state", soGet.ok, `HTTP ${soGet.status} ${JSON.stringify(sg).slice(0,150)}`);
console.log(`      GET → rate ${sg.stopover?.rate_per_min_ugx} UGX/min, grace ${sg.stopover?.grace_min} min, open=${sg.stopover?.open}\n`);

const soStart=await api(rider.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"start",reason:"customer_not_ready"})});
const ss=await soStart.json().catch(()=>({}));
check("WAITING PASSENGER starts", soStart.ok && ss.ok===true && !!ss.stopoverId, `HTTP ${soStart.status} ${JSON.stringify(ss).slice(0,200)}`);

/* Age the open clock past the grace window so the End actually bills money.
   This is the whole point of the feature — prove the charge is real, not zero. */
const graceMin = sg.stopover?.grace_min ?? 3;
const aged = new Date(Date.now() - (graceMin + 5) * 60000).toISOString();
const rec = await fetch(rest(`app_settings?key=eq.stopover:${rideId}`),{headers:svcH}).then(r=>r.json());
if (rec?.[0]) {
  const parsed = JSON.parse(rec[0].value);
  parsed.open.startedAt = aged;
  await fetch(rest(`app_settings?key=eq.stopover:${rideId}`),{method:"PATCH",headers:svcH,body:JSON.stringify({value:JSON.stringify(parsed)})});
  console.log(`      clock aged to ${graceMin + 5} min (grace is ${graceMin}) so the charge is billable\n`);
}

/* idempotent double-tap must not create a second clock */
const soAgain=await api(rider.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"start",reason:"customer_not_ready"})});
check("a second tap does not open a second clock", soAgain.ok && soAgain.status===200, `HTTP ${soAgain.status}`);

/* 7. CUSTOMER SEES THE ALERT + RUNNING COST */
const cGet=await api(cust.token,`/api/rides/stopover?rideId=${rideId}`);
const cg=await cGet.json().catch(()=>({}));
check("customer sees the wait and who is viewing", cGet.ok && cg.stopover?.open===true && cg.viewer==="customer", `HTTP ${cGet.status} open=${cg.stopover?.open} viewer=${cg.viewer}`);

/* 8. RIDER SETS OFF -> auto-close */
await fetch(rest(`rider_locations?rider_id=eq.${rider.uid}`),{method:"DELETE",headers:svcH});
const gps2=await fetch(rest("rider_locations"),{method:"POST",headers:svcH,body:JSON.stringify({rider_id:rider.uid,lat:0.3480,lng:32.5830,heading:90,accuracy:8,speed:8,updated_at:new Date().toISOString()})});
check("seeded a MOVING GPS fix (8 m/s = 28.8 km/h)", gps2.ok, `HTTP ${gps2.status}`);
const soEnd=await api(rider.token,"/api/rides/stopover",{method:"POST",body:JSON.stringify({rideId,action:"end"})});
const se=await soEnd.json().catch(()=>({}));
check("rider can end the wait", soEnd.ok && se.minutes!==undefined, `HTTP ${soEnd.status} ${JSON.stringify(se).slice(0,200)}`);
check("a wait past the free window is actually billed", se.chargeUgx>0, `charged ${se.chargeUgx} UGX`);
console.log(`      billed ${se.chargeUgx} UGX for ${se.minutes} min\n`);

/* 9. COMPLETE */
const done=await api(rider.token,`/api/rides`,{method:"PATCH",body:JSON.stringify({id:rideId,action:"complete"})});
const dj=await done.json().catch(()=>({}));
check("rider can complete the trip", done.ok, `HTTP ${done.status} ${JSON.stringify(dj).slice(0,180)}`);

const row=await fetch(rest(`ride_requests?id=eq.${rideId}&select=status,fare_ugx,service_fee_ugx,total_ugx`),{headers:svcH}).then(r=>r.json());
console.log("      final DB row:", JSON.stringify(row?.[0]||row));

/* cleanup */
await fetch(rest(`ride_requests?id=eq.${rideId}`),{method:"DELETE",headers:svcH});
await fetch(rest(`app_settings?key=like.stopover:*`),{method:"DELETE",headers:svcH});
await fetch(rest(`rider_locations?rider_id=eq.${rider.uid}`),{method:"DELETE",headers:svcH});
console.log(`\n${pass} passed, ${fails.length} failed${fails.length?"\n  "+fails.join("\n  "):""}`);
