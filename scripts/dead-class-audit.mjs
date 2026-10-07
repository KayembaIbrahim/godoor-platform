/**
 * Dead-class audit.
 *
 * The 800-dead-class incident came from utility tokens that Tailwind silently
 * drops (off-scale opacity like `/8`, spacing like `h-4.5`, or a colour that
 * cannot be split into channels). This re-extracts every candidate token from
 * real `className` context and checks each against the compiled CSS.
 *
 * Self-tested before it is trusted — see `selfTest()` at the bottom.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CSS_PATH = process.argv[2] || "/tmp/tw-out.css";
const ROOTS = ["src"];

// Tokens that are legitimately not CSS rules. Lucide injects `lucide lucide-x`
// as SVG attributes; `group`/`peer` are behavioural hooks consumed at runtime.
const ALLOW = /^(lucide(-.*)?|group(-.*)?|peer(-.*)?|dark|light)$/;

// A real Tailwind utility always starts with a known prefix. Anything else in a
// className is a word, a ternary branch, or a JS expression that my string
// extraction happened to sweep up (`roleFilter`, `doc.role`, `activeFilterCount`).
const PREFIX =
  /^-?(p|m|inset|space)-(x|y|xy|s|e|t|r|b|l)?-?[0-9./]+$|^(w|h|min-w|min-h|max-w|max-h|size|flex|grid|cols|rows|gap|order|col|row|gap|place|items|justify|self|content|self|place|align)-/;
const UTILITY = new RegExp(
  `^(-|!)?(` +
    // structural / layout
    `flex|grid|block|inline|inline-flex|inline-grid|table|contents|hidden|visible|relative|absolute|fixed|sticky|static` +
    // box
    `|w|h|min-w|min-h|max-w|max-h|size|p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|space-[xy]|space-y-reverse` +
    // position
    `|top|right|bottom|left|inset|inset-x|inset-y|z` +
    // typography
    `|text|font|leading|tracking|whitespace|break|truncate|align|uppercase|lowercase|capitalize|underline|line-through|no-underline|ordinal|list|indent` +
    // colour
    `|bg|from|via|to|decoration|outline|ring|shadow|fill|stroke|caret|accent|divide` +
    // borders
    `|border|rounded|rounded-t|rounded-b|rounded-l|rounded-r|cursor|select|resize|appearance|transition|duration|ease|delay|animate` +
    // effects
    `|opacity|mix-blend|blur|brightness|contrast|drop-shadow|grayscale|invert|saturate|sepia|backdrop|filter|transform|translate|rotate|scale|skew|perspective|origin|transform-origin` +
    // interactivity
    `|pointer-events|resize|scroll|touch|will-change|object|aspect|overflow|sr-only|not-sr-only|container|prose` +
    // variants that carry a utility after them
    `|sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|group-hover|group-focus|peer-checked|dark|first|last|odd|even|checked|required|invalid|read-only|placeholder|motion-safe|motion-reduce|print` +
  `)([-/].*)?$`,
);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(p) && !/\.d\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/** CSS escapes one char class at a time: `md:flex` -> `.md\:flex` */
function toSelector(token) {
  // The `!` important prefix is escaped in the output too: `!flex` -> `.\!flex`.
  return "." + token.replace(/([!.:/[\]()%,#])/g, "\\$1");
}

/** `hover:bg-go/20` -> `bg-go/20`; the base is what Tailwind generates. */
function baseOf(token) {
  const i = token.lastIndexOf(":");
  return i === -1 ? token : token.slice(i + 1);
}

/**
 * Pull candidate utility tokens out of className contexts only. Scanning the
 * whole file produces false positives (English words, import paths), so we only
 * read string literals and template literals inside className expressions.
 */
function extractTokens(src) {
  const tokens = new Set();
  const add = (raw) => {
    for (let t of raw.split(/\s+/)) {
      t = t.trim();
      if (!t || t.length > 90) continue;
      if (!/^[a-z0-9:[\]/.#()%!-]+$/i.test(t)) continue;
      if (ALLOW.test(baseOf(t))) continue;
      // Strip any variant prefix (`hover:`, `md:`) and keep only what looks like
      // a genuine utility, so JS words swept up by the brace scan are dropped.
      const base = baseOf(t);
      if (!UTILITY.test(base)) continue;
      tokens.add(t);
    }
  };

  // className="..." / className={'...'} / className={`...`}
  const re = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
  let m;
  while ((m = re.exec(src))) add(m[1] ?? m[2] ?? m[3] ?? "");

  // className={cond ? "a b" : "c d"} and multi-line variants
  const braceRe = /className\s*=\s*\{([\s\S]{0,600}?)\}\s*\n/g;
  while ((m = braceRe.exec(src))) {
    for (const lit of m[1].matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
      add(lit[1] ?? lit[2] ?? lit[3] ?? "");
    }
  }
  return tokens;
}

const css = readFileSync(CSS_PATH, "utf8");

// Confirms the checker can find a class we know is in the build, and can
// correctly reject one we know is absent. Without this, "0 dead" is meaningless.
function selfTest() {
  const mustFind = ["flex", "md:flex", "bg-go", "border-border"];
  // Deliberately off-scale on both axes: opacity 7 and spacing 4.25 are not in
  // the config's extended scales, so Tailwind must drop them. These are the
  // two silent-drop classes from the original 800-dead-class incident.
  const mustMiss = ["bg-go/7", "h-4.25"];
  const failures = [];
  for (const t of mustFind) if (!css.includes(toSelector(t))) failures.push(`cannot find ${t}`);
  for (const t of mustMiss) if (css.includes(toSelector(t))) failures.push(`wrongly found ${t}`);
  return failures;
}

const failures = selfTest();
if (failures.length) {
  console.error("AUDIT INVALID — checker is broken:\n  " + failures.join("\n  "));
  process.exit(2);
}

const found = new Map(); // token -> file:line
let total = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    for (const t of extractTokens(src)) {
      total++;
      if (found.has(t)) continue;
      const line = src.slice(0, src.indexOf(t)).split("\n").length;
      found.set(t, `${file}:${line}`);
    }
  }
}

const dead = [];
for (const [t, where] of found) {
  if (!css.includes(toSelector(t))) dead.push(`${t}  ← ${where}`);
}

console.log(`self-test: PASS`);
console.log(`tokens scanned: ${total}  (unique: ${found.size})`);
console.log(`dead classes:   ${dead.length}`);
if (dead.length) {
  console.log("\n" + dead.slice(0, 60).join("\n"));
  process.exit(1);
}
console.log("\nAll utility tokens resolve to a real CSS rule.");
