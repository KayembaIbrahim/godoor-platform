/**
 * Creates (or resets) a test account and prints a ready-to-use access token.
 * Only used for local debugging against the live project.
 *
 * node scripts/test-user.mjs customer@example.com password123 customer
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const [email = "test@example.com", password = "test1234", role = "customer", name = "Test User"] = process.argv.slice(2);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

const existing = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: H }).then((r) => r.json());
let user = (existing.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase());

if (!user) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST", headers: H,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role, name, phone: "" } }),
  });
  user = await res.json();
  if (user.id === undefined) { console.error("create failed", JSON.stringify(user)); process.exit(1); }
} else {
  await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
    method: "PUT", headers: H, body: JSON.stringify({ password, user_metadata: { role, name, phone: "" } }),
  });
}

const token = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: H, body: JSON.stringify({ email, password }),
}).then((r) => r.json()).then((j) => j.access_token);

console.log(`USER_ID=${user.id}`);
console.log(`TOKEN=${token}`);
fs.writeFileSync("scripts/.test-token", `${user.id}\n${token}\n`);