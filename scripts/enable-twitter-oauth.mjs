/**
 * Enables Twitter/X OAuth on a Supabase project via the Management API.
 * Secrets are read from env — NEVER commit them to git.
 * Supabase's Twitter provider is API-key based (Twitter OAuth 1.0a): it needs
 * api_key + api_secret, not an OAuth2 client_id.
 *
 * Usage:
 *   TWITTER_API_KEY=... TWITTER_API_SECRET=... \
 *     node scripts/enable-twitter-oauth.mjs [--project llzqkduccdbbetevpoql]
 * Defaults project to llzqkdu... (production). Set SUPABASE_ACCESS_TOKEN in env or .env.local.
 * NOTE: token must have auth_config write scope for the target project, else API returns auth_config_write missing.
 */
import fs from "node:fs";
const apiKey = process.env.TWITTER_API_KEY || process.env.X_API_KEY;
const apiSecret = process.env.TWITTER_API_SECRET || process.env.X_API_SECRET;
if (!apiKey || !apiSecret) { console.error("TWITTER_API_KEY / TWITTER_API_SECRET missing"); process.exit(1); }
let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  try {
    for (const l of fs.readFileSync(".env.local","utf8").split("\n")) if (l.startsWith("SUPABASE_ACCESS_TOKEN=")) token = l.slice(22).trim().replace(/^"|"$/g,"");
  } catch {}
}
if (!token) { console.error("SUPABASE_ACCESS_TOKEN missing"); process.exit(1); }
const args = process.argv.slice(2);
let ref = "llzqkduccdbbetevpoql"; // production (Vercel env)
const i = args.indexOf("--project"); if (i >= 0 && args[i+1]) ref = args[i+1];

// Management API: PATCH /v1/projects/{ref}/auth/config expects the full config object
// with external_twitter_* fields. We GET first for the shape, then PATCH.
const base = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const getRes = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
if (!getRes.ok) {
  console.error(`GET config failed HTTP ${getRes.status}: ${(await getRes.text()).slice(0,400)}`);
  console.error(`If this says auth_config_read missing, the token lacks access to project ${ref}. Use the project owner's dashboard token.`);
  process.exit(1);
}
const cfg = await getRes.json();
cfg.external_twitter_enabled = true;
cfg.external_twitter_client_id = apiKey;      // Twitter API Key
cfg.external_twitter_secret = apiSecret;      // Twitter API Secret
const patchRes = await fetch(base, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(cfg),
});
const txt = await patchRes.text();
console.log(`PATCH ${ref} HTTP ${patchRes.status}`);
console.log(txt.slice(0,800));
if (!patchRes.ok) process.exit(1);
console.log("Twitter OAuth enabled on", ref);
