/**
 * Platform health sweep — hits every API route the app defines and reports the
 * status code, so a broken feature shows up as a red line instead of a
 * customer support ticket.
 *
 * READ-ONLY by design: it only issues GET/HEAD requests, so it cannot create
 * an order, move money or publish a background. Routes that legitimately
 * require a signed-in user (or an admin) are expected to answer 401/403 — that
 * is the route working, not the route failing. A 404, a 500 or a timeout is a
 * real defect.
 *
 * Run against production:  BASE_URL=https://godoor.site node scripts/api-health.mjs
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const BASE = (process.env.BASE_URL || "https://godoor.site").replace(/\/$/, "");
const ROOT = process.cwd();

/** Find every route.ts under the app's api directory. */
function findRoutes(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) findRoutes(p, out);
    else if (entry === "route.ts" || entry === "route.tsx") out.push(p);
  }
  return out;
}

const routeFiles = findRoutes(join(ROOT, "src/app/api"));

/** Which HTTP verbs does a route file export? */
function methodsOf(src) {
  const verbs = [];
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let m;
  while ((m = re.exec(src))) verbs.push(m[1]);
  if (/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src)) {
    const re2 = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
    let m2;
    while ((m2 = re2.exec(src))) if (!verbs.includes(m2[1])) verbs.push(m2[1]);
  }
  return verbs;
}

/** The URL path a route file is mounted at. */
function urlOf(file) {
  // Relative to src/app, so "api/orders/route.ts" → "/api/orders".
  const rel = relative(join(ROOT, "src/app"), file).replace(/\\/g, "/");
  const dir = rel.replace(/\/route\.tsx?$/, "");
  const p = dir.replace(/\[\.\.\.(.+?)\]/g, "$1").replace(/\[(.+?)\]/g, "$1");
  return "/" + p.replace(/\/$/, "");
}

/** Dynamic segments get a concrete stand-in so the route is actually reached. */
function concrete(path) {
  return path
    .replace(/\bid\b/g, "test-id")
    .replace(/\borderId\b/g, "test-order")
    .replace(/\bmerchantId\b/g, "test-merchant")
    .replace(/\buserId\b/g, "test-user");
}

const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;

const targets = [];
for (const file of routeFiles) {
  const src = readFileSync(file, "utf8");
  const url = urlOf(file);
  for (const verb of methodsOf(src)) {
    // Only read verbs — this sweep must not mutate production data.
    if (!["GET", "HEAD"].includes(verb)) continue;
    const c = concrete(url);
    if (only && !only.test(c)) continue;
    targets.push({ file: relative(ROOT, file), verb, url: c });
  }
}

console.log(`→ ${BASE}  (${targets.length} read-only route checks)\n`);

const results = [];

for (const t of targets) {
  const started = Date.now();
  let status = 0;
  let note = "";
  // A per-request deadline. A single shared AbortController would abort every
  // request that came after the first slow one, which reads as a wall of
  // failures that are really just the previous timeout leaking forward.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}${t.url}`, {
      method: t.verb,
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    status = res.status;
    const body = await res.text();
    note = body.slice(0, 110).replace(/\s+/g, " ");
  } catch (e) {
    status = -1;
    note = String(e?.message || e).slice(0, 110);
  }
  clearTimeout(timer);
  const ms = Date.now() - started;

  /* `/api/admin/*` is deliberately answered with a plain-text 404 for anyone
     without an admin session — see src/proxy.ts. That is the security gate
     working, not a missing route, so it must not be reported as a failure.

     A JSON 404 (`{"error":"Not found"}`) is different again: the route ran and
     answered "no such record" for the stand-in id. Also not a failure. */
  const adminLocked = t.url.startsWith("/api/admin/") && status === 404 && note === "Not Found";
  const recordMissing = status === 404 && note.startsWith("{");
  const bad = !adminLocked && !recordMissing && (status === -1 || status === 404 || status >= 500);

  results.push({ ...t, status, note, ms, adminLocked, recordMissing, bad });
  const tag = bad ? "FAIL" : adminLocked ? "lock" : recordMissing ? "none" : "ok  ";
  console.log(
    `${tag} ${String(status).padStart(4)} ${String(ms).padStart(5)}ms  ${t.verb.padEnd(4)} ${t.url}` +
      (bad ? `\n         ${note}` : ""),
  );
}

const failed = results.filter((r) => r.bad);
const slow = results.filter((r) => r.ms > 5000);

console.log(`\n── SUMMARY ──`);
console.log(`  checked : ${results.length}`);
console.log(`  failed  : ${failed.length}${failed.length ? "  → " + failed.map((f) => f.status + " " + f.url).join(", ") : ""}`);
console.log(`  admin-locked (404 by design, anonymous): ${results.filter((r) => r.adminLocked).length}`);
console.log(`  slow>5s : ${slow.length}${slow.length ? "  → " + slow.map((s) => s.ms + "ms " + s.url).join(", ") : ""}`);
const byStatus = {};
for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log("  by status: " + Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("  "));

process.exit(failed.length ? 1 : 0);
