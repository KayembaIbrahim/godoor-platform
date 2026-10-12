import { readFileSync, readdirSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const val = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
};

const svc = val("SUPABASE_SERVICE_ROLE_KEY");
const anon = val("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const token = "REDACTED_VERCEL_TOKEN";
const sbp = "REDACTED_SUPABASE_ACCESS_TOKEN";
const admin = "gdr-066f2fa3f4e94cae441295fd72e39c79";
const pw = "Kayemba";

const js = readdirSync("/tmp/ch").filter((f) => f.endsWith(".js"));
const all = js.map((f) => readFileSync("/tmp/ch/" + f, "utf8")).join("\n");

console.log("chunks scanned:", js.length, "bytes:", all.length);
console.log("");
const checks = [
  ["SUPABASE_SERVICE_ROLE_KEY (value)", svc],
  ["supabase access token (sbp_)", sbp],
  ["vercel token (vcp_)", token],
  ["ADMIN_PATH_SECRET", admin],
  ["operator password", pw],
  ["NEXT_PUBLIC anon key (public by design)", anon],
];
for (const [label, needle] of checks) {
  if (!needle) { console.log(`SKIP  ${label} -- value not found in .env.local`); continue; }
  const n = all.split(needle).length - 1;
  const verdict = label.includes("public by design") ? (n > 0 ? "OK present" : "not inlined") : n === 0 ? "CLEAN" : "*** LEAK ***";
  console.log(`${String(n).padStart(4)}  ${label.padEnd(42)} ${verdict}`);
}

// Any JWT in the bundle must be role:anon, never service_role.
const jwts = [...new Set(all.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) || [])];
console.log("\nJWTs in bundle:", jwts.length);
for (const j of jwts) {
  let role = "undecodable";
  try {
    const p = JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString());
    role = p.role || "(no role)";
  } catch {}
  const ok = role === "anon";
  console.log(`  role=${role} ${ok ? "OK (RLS-protected public key)" : "*** NOT PUBLIC ***"}`);
}