// Probe: why does POST /api/push/subscribe fail for a signed-in user?
// Read-only: the synthetic endpoint is cleaned up afterwards.
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.vercel-prod", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.argv[2];
const PW = process.argv[3];
if (!url || !anon) throw new Error("prod env unreadable");

const ORIGIN = "https://godoor.site";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

// 1. sign in
const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }),
}).then((r) => r.json());
if (!auth.access_token) throw new Error("sign-in failed: " + JSON.stringify(auth).slice(0, 200));
const token = auth.access_token;
check("customer signs in", true);

// 2. realistic push subscription payload
const endpoint = `https://fcm.googleapis.com/fcm/send/probe-${Date.now()}`;
const payload = {
  endpoint,
  p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  auth: "8eDyX_uCN0XRhSbY5hs7Hg",
};

// 3. hit the real endpoint
const res = await fetch(`${ORIGIN}/api/push/subscribe`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(payload),
});
const text = await res.text();
check(
  "POST /api/push/subscribe with valid session",
  res.ok,
  `status=${res.status} body=${text.slice(0, 300)}`,
);

// 4. is it the table? probe it directly with the anon key (PostgREST validates names)
for (const col of ["user_id", "endpoint", "p256dh", "auth", "user_agent", "updated_at"]) {
  const r = await fetch(`${url}/rest/v1/push_subscriptions?select=${col}&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const b = await r.text();
  const ok = r.ok;
  console.log(`      col ${col.padEnd(12)} ${ok ? "ok" : "ERR " + b.slice(0, 120)}`);
  if (!ok) results.push({ name: `column ${col}`, pass: false, detail: b.slice(0, 160) });
}

// 5. cleanup the synthetic row so production is left as found
if (res.ok) {
  const del = await fetch(`${ORIGIN}/api/push/subscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint }),
  });
  check("cleanup probe subscription", del.ok, `status=${del.status}`);
} else {
  console.log("      (no row created, nothing to clean up)");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
