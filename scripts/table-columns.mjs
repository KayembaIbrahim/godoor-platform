/** Extracts the columns the code reads/writes on tables missing from the DB. */
import fs from "node:fs";

const MISSING = process.argv.slice(2);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
    if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})("src");

for (const table of MISSING) {
  const cols = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const re = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\)`, "g");
    let m;
    while ((m = re.exec(src))) {
      // Take a generous window after the call and pull out quoted keys.
      const win = src.slice(m.index, m.index + 900);
      const sel = win.match(/\.select\(\s*["'`]([^"'`]*)["'`]/);
      if (sel?.[1]) for (const c of sel[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!cols.has(c)) cols.set(c, f);
      }
      // .insert({ ... }) / .update({ ... }) keys directly after the chain
      const obj = win.match(/\.(?:insert|upsert|update)\(\s*\{([\s\S]{0,800}?)\}\s*\)/);
      if (obj) for (const k of obj[1].matchAll(/(?:^|[,{\s])([a-z_][a-z0-9_]*)\s*[:,]/g)) {
        const key = k[1];
        if (["if","const","let","return","await","data","error"].includes(key)) continue;
        if (!cols.has(key)) cols.set(key, f);
      }
      // .eq/.order/.in on columns
      for (const c of win.matchAll(/\.(?:eq|order|in|neq|is|gt|lt)\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)) {
        if (!cols.has(c[1])) cols.set(c[1], f);
      }
    }
  }
  console.log(`\n### ${table}  (${cols.size} columns)`);
  for (const [c, f] of cols) console.log(`    ${c.padEnd(26)} ← ${f}`);
}