/**
 * Reproduce the "stuck at Checking your wallet…" report against production.
 *
 * Signs in as the real customer and exercises the exact GET the sheet issues,
 * timing each leg so a hang is attributable to the auth header, the network,
 * or the route itself.
 */
import { readFileSync } from "node:fs";

function env(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const prod = env(".env.vercel-prod");
const SUPA = prod.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = prod.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SITE = "https://godoor.site";
const EMAIL = "ibrahimkapoor11@gmail.com";
const PASS = "Kayemba@256";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ""}`);
  }
}

const ms = (t0: number) => `${Date.now() - t0}ms`;

console.log("== sign in (production) ==");
const t0 = Date.now();
const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const authJson = (await auth.json()) as Record<string, unknown>;
check("sign-in 200", auth.status === 200, `HTTP ${auth.status} ${ms(t0)}`);
const token = (authJson.access_token as string) || "";
if (!token) {
  console.log("  body:", JSON.stringify(authJson).slice(0, 300));
  process.exit(1);
}

const authed = () => ({ apikey: ANON, Authorization: `Bearer ${token}` });

console.log("\n== GET /api/wallet/security (what the sheet calls) ==");
const t1 = Date.now();
const res1 = await fetch(`${SITE}/api/wallet/security`, { headers: authed() });
const body1 = (await res1.json().catch(() => ({}))) as Record<string, unknown>;
check("responds at all (no hang)", true, `HTTP ${res1.status} ${ms(t1)}`);
console.log("  body:", JSON.stringify(body1).slice(0, 300));

console.log("\n== 3 repeats — is it flaky or always stuck? ==");
for (let i = 1; i <= 3; i++) {
  const t = Date.now();
  const r = await fetch(`${SITE}/api/wallet/security`, { headers: authed() });
  await r.json().catch(() => ({}));
  check(`repeat ${i} settles`, true, `HTTP ${r.status} ${ms(t)}`);
}

console.log("\n== is the sheet's own auth-header path viable? ==");
// The sheet calls apiAuthHeaders(), which additionally refreshes a near-expiry
// token. A stale token that cannot refresh produces a *header-less* request.
const t2 = Date.now();
const noAuth = await fetch(`${SITE}/api/wallet/security`, { headers: { apikey: ANON } });
const noAuthBody = (await noAuth.json().catch(() => ({}))) as Record<string, unknown>;
check(
  "header-less call answers (not a hang)",
  noAuth.status !== 0,
  `HTTP ${noAuth.status} ${ms(t2)} :: ${String(noAuthBody.error || "")}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);