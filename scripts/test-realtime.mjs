/** Definitive: does postgres_changes on ride_requests actually deliver an INSERT? */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function parse(f){const e={};for(const l of readFileSync(f,"utf8").split("\n")){const m=/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/.exec(l);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}return e;}
const p=parse(".env.vercel-prod");
const SB=p.NEXT_PUBLIC_SUPABASE_URL, SVC=p.SUPABASE_SERVICE_ROLE_KEY;

const rt=createClient(SB,SVC,{auth:{persistSession:false,autoRefreshToken:false}});
let got=null;
const ch=rt.channel("probe-ride-requests")
  .on("postgres_changes",{event:"*",schema:"public",table:"ride_requests"},(pl)=>{got=pl;});
await new Promise((res)=>{ const t=setTimeout(()=>res("timeout"),12000); ch.subscribe((st)=>{ console.log("subscribe status:",st); if(st==="SUBSCRIBED"){clearTimeout(t);res("ok");} }); });
console.log("subscribed; writing a probe row…");
const id=crypto.randomUUID();
const ins=await rt.from("ride_requests").insert({id,customer_id:null,customer_name:"__rt_probe__",status:"requested"}).select("id");
console.log("insert ->",ins.status,ins.error?ins.error.message:"ok");
await new Promise(r=>setTimeout(r,6000));
console.log(got?`REALTIME WORKS: event ${got.eventType} on ${got.table}`:"NO EVENT RECEIVED after 6s");
await rt.from("ride_requests").delete().eq("id",id);
await rt.removeChannel(ch);
process.exit(0);
