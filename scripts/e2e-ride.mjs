/** End-to-end: customer books a Boda ride, then we check the rider sees it. */
import { readFileSync } from "node:fs";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, ANON=p.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC=p.SUPABASE_SERVICE_ROLE_KEY;
const SITE="https://godoor.site";
const PASS="Kayemba Ibrahim";
async function signIn(email){const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:ANON,"Content-Type":"application/json"},body:JSON.stringify({email,password:PASS})});const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.msg);return{uid:j.user.id,email:j.user.email,token:j.access_token};}
const H=(t)=>({Authorization:`Bearer ${t}`,apikey:ANON,"Content-Type":"application/json"});
const rest=(x)=>`${SB}/rest/v1/${x}`;
const svc=async(x,o={})=>fetch(rest(x),{...o,headers:{apikey:SVC,Authorization:`Bearer ${SVC}`,"Content-Type":"application/json",...(o.headers||{})}});

const cust=await signIn("ibrahimkapoor11@gmail.com");
const rider=await signIn("leeguho11@gmail.com");
console.log(`customer ${cust.uid.slice(0,8)}  rider ${rider.uid.slice(0,8)}\n`);

/* What does the customer's profile look like? */
const prof=await svc(`profiles?user_id=eq.${cust.uid}&select=*`).then(r=>r.json());
console.log("customer profile:", JSON.stringify(prof?.[0]||prof).slice(0,300),"\n");

/* BOOK a ride as the customer */
const body={ customer_id:cust.uid, pickup:"Makerere Main Gate, Kampala", dropoff:"Nakasero Road, Kampala",
  pickup_lat:0.3476, pickup_lng:32.5825, dropoff_lat:0.3125, dropoff_lng:32.5750,
  vehicle_type:"boda", customer_name:"Ibrahim", customer_phone:"+256700000000" };
const book=await fetch(`${SITE}/api/rides`,{method:"POST",headers:H(cust.token),body:JSON.stringify(body)});
const bookJson=await book.json().catch(()=>({}));
console.log(`BOOK  POST /api/rides -> HTTP ${book.status}`);
console.log("      ",JSON.stringify(bookJson).slice(0,300),"\n");

const rideId=bookJson.ride?.id||bookJson.id||bookJson.ride_request?.id;
if(!rideId){console.log("!! no ride id — cannot continue");process.exit(1);}
console.log(`created ride ${rideId}\n`);

/* Does it exist in the DB? */
const row=await svc(`ride_requests?id=eq.${rideId}&select=*`).then(r=>r.json());
console.log("DB row:",JSON.stringify(row?.[0]||row).slice(0,500),"\n");

/* Does the RIDER see it? */
const open=await fetch(`${SITE}/api/rides?open=1`,{headers:H(rider.token)});
const oj=await open.json().catch(()=>({}));
console.log(`RIDER  GET /api/rides?open=1 -> HTTP ${open.status}, ${(oj.rides||[]).length} ride(s)`);
console.log("      ",JSON.stringify(oj).slice(0,400),"\n");

const mine=await svc(`ride_requests?status=eq.requested&select=id,status,customer_name,vehicle_type,created_at`).then(r=>r.json());
console.log("open requests in DB:",JSON.stringify(mine).slice(0,300));
