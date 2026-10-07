const T = process.env.SUPABASE_ACCESS_TOKEN || "";
const r=await fetch("https://api.supabase.com/v1/projects",{headers:{Authorization:`Bearer ${T}`}});
const j=await r.json().catch(()=>({}));
const list=Array.isArray(j)?j:(j.projects||[]);
console.log("token projects:",list.length);
for(const p of list) console.log("  ",p.ref,p.name);
console.log("\nprod ref llzqkduccdbbetevpoql present:", list.some(p=>p.ref==="llzqkduccdbbetevpoql"));
const q=await fetch("https://api.supabase.com/v1/projects/llzqkduccdbbetevpoql/database/query",{method:"POST",headers:{Authorization:`Bearer ${T}`,"Content-Type":"application/json"},body:JSON.stringify({query:"select 1"})});
console.log("direct prod DB query ->",q.status,(await q.text()).slice(0,160));
