/** Resolve PostgREST OpenAPI $refs into plain column lists. Read-only. */
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${URL_BASE}/rest/v1/`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/openapi+json" },
});
const spec = await res.json();

const deref = (o) => {
  if (!o || typeof o !== "object") return o;
  if (o.$ref) return deref(spec.parameters?.[o.$ref.split("/").pop()] ?? {});
  return o;
};

for (const [path, ops] of Object.entries(spec.paths)) {
  const get = ops.get;
  if (!get?.parameters) continue;
  const cols = get.parameters
    .map((p) => {
      const d = deref(p);
      const props = d.schema?.properties;
      return props && Object.keys(props).length ? Object.keys(props) : [d.name];
    })
    .flat();
  console.log(`${path.replace(/^\//, "").padEnd(22)} ${cols.join(", ")}`);
}