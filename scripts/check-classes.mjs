// Verify a list of Tailwind classes actually compiled into the built CSS.
// Escaping is done in JS (not bash) because the CSS escapes "/" and ":" itself.
import fs from "node:fs";

const cssPath = process.argv[2] || "/tmp/tw2.css";
const classes = process.argv.slice(3);
const css = fs.readFileSync(cssPath, "utf8");

const esc = (c) => c.replace(/([/:.[\]%])/g, "\\$1");

let bad = [];
for (const c of classes) {
  // Tailwind escapes special chars in the class name; build the selector
  // fragment and look for it as a substring.
  const needle = "." + esc(c);
  const found = css.includes(needle);
  console.log(`${found ? "ok     " : "MISSING"}  ${c}`);
  if (!found) bad.push(c);
}
console.log(`\nchecked ${classes.length}, missing ${bad.length}`);
if (bad.length) process.exit(1);
