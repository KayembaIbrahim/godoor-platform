// Tokenise the QuickServicesGrid tile block (lines 55-195 only).
//
// Scoped deliberately: the modals further down the file sit on `bg-[#131F38]`
// where white text IS correct, so a global replace would break them.
import fs from "node:fs";

const P = "src/components/QuickServicesGrid.tsx";
const lines = fs.readFileSync(P, "utf8").split("\n");

// 1-indexed tile block = index 54..194
const START = 54;
const END = 195;
const before = lines.slice(START, END).join("\n");

let block = lines.slice(START, END).join("\n");

// The bug: 16 service labels/sub-labels were `text-white` while sitting
// directly on --bg (#FFFFFF in light mode) => invisible text.
block = block.replaceAll('text-xs font-bold text-white leading-tight', 'text-xs font-bold text-fg leading-tight');
block = block.replaceAll('text-[10px] text-slate-400 leading-tight', 'text-[10px] text-muted leading-tight');
block = block.replaceAll('text-[10px] text-slate-500 leading-tight', 'text-[10px] text-muted leading-tight');
block = block.replaceAll('font-bold text-white', 'font-bold text-fg');
block = block.replaceAll('text-xs font-bold text-white', 'text-xs font-bold text-fg');

// Per-service accents. Same hue set as before (so category recognition is
// unchanged) but expressed through the design tokens instead of raw hex, so
// the whole grid now themes with the app.
const map = [
  [/bg-\[#FF5500\]/g, "bg-go"],
  [/text-\[#FF5500\]/g, "text-go"],
  [/border-\[#FF5500\]/g, "border-go"],
  [/shadow-\[#FF5500\]/g, "shadow-go"],
  [/bg-\[#F59E0B\]/g, "bg-warning"],
  [/text-\[#F59E0B\]/g, "text-warning"],
  [/border-\[#F59E0B\]/g, "border-warning"],
  [/shadow-\[#F59E0B\]/g, "shadow-warning"],
  [/bg-\[#10B981\]/g, "bg-success"],
  [/text-\[#10B981\]/g, "text-success"],
  [/border-\[#10B981\]/g, "border-success"],
  [/shadow-\[#10B981\]/g, "shadow-success"],
  [/bg-\[#8B5CF6\]/g, "bg-purple"],
  [/text-\[#8B5CF6\]/g, "text-purple"],
  [/border-\[#8B5CF6\]/g, "border-purple"],
  [/shadow-\[#8B5CF6\]/g, "shadow-purple"],
  [/bg-\[#EAB308\]/g, "bg-warning"],
  [/text-\[#EAB308\]/g, "text-warning"],
  [/border-\[#EAB308\]/g, "border-warning"],
  [/shadow-\[#EAB308\]/g, "shadow-warning"],
  [/bg-\[#FFCC00\]/g, "bg-go"],
  [/text-\[#FFCC00\]/g, "text-go"],
  [/bg-\[#ED1B24\]/g, "bg-danger"],
  [/text-\[#ED1B24\]/g, "text-danger"],
  // Fallback discs that were #1E293B / #253550
  [/bg-\[#1E293B\]/g, "bg-navy-soft"],
  [/hover:bg-\[#253550\]/g, "hover:bg-navy-hover"],
  [/bg-slate-700\/60/g, "bg-elevated"],
  [/text-slate-300/g, "text-fg"],
  [/text-slate-200/g, "text-fg"],
  [/border-slate-600/g, "border-border"],
];
for (const [re, to] of map) block = block.replace(re, to);

const after = block;
lines.splice(START, END - START, ...block.split("\n"));
fs.writeFileSync(P, lines.join("\n"));

console.log(`text-white remaining in tile block: ${(block.match(/text-white/g) || []).length}`);
console.log(`text-fg added:                      ${(block.match(/text-fg/g) || []).length}`);
console.log(`raw hex left in tile block:         ${(block.match(/\[#[0-9A-Fa-f]{3,8}\]/g) || []).length}`);
console.log(`changed: ${before !== after}`);
