// Flip the landing hero from the previous "dark navy + particles" direction to
// the current brief: light, spacious, teal identity, orange CTA.
//
// Scoped to the hero block only (lines 60-157). The 40%-off promo banner below
// is an intentional orange gradient where white text IS correct, so a global
// replace would break it.
import fs from "node:fs";

const P = "src/components/home/DarkHero.tsx";
const lines = fs.readFileSync(P, "utf8").split("\n");
const START = 59; // 0-indexed -> line 60
const END = 157;  // exclusive -> through line 157

let block = lines.slice(START, END).join("\n");
const before = block;

const swaps = [
  // Section shell: hardcoded near-black -> themed light surface
  ['className="relative isolate overflow-hidden bg-[#070B18] pb-14 pt-16 text-white md:pb-20 md:pt-24"',
   'className="relative isolate overflow-hidden bg-bg pb-14 pt-16 md:pb-20 md:pt-24"'],
  // Eyebrow pill
  ['border border-white/12 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/85 backdrop-blur',
   'border border-brand/25 bg-brand/10 px-3.5 py-1.5 text-xs font-semibold text-brand'],
  ['<Sparkles className="h-3.5 w-3.5 text-go" />', '<Sparkles className="h-3.5 w-3.5 text-brand" />'],
  // Headline
  ['tracking-tight text-white sm:text-5xl', 'tracking-tight text-fg sm:text-5xl'],
  // Supporting copy
  ['text-sm leading-relaxed text-white/65 sm:text-base', 'text-sm leading-relaxed text-muted sm:text-base'],
  // Search shell -> real elevated surface
  ['rounded-2xl border border-white/12 bg-white/8 p-2 backdrop-blur-md sm:flex-row sm:items-center',
   'rounded-2xl border border-border bg-surface p-2 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)] sm:flex-row sm:items-center'],
  // Location button
  ['transition hover:bg-white/8 sm:max-w-[15rem]', 'transition hover:bg-elevated sm:max-w-[15rem]'],
  ['text-[11px] font-semibold text-white"', 'text-[11px] font-semibold text-fg"'],
  ['text-[10px] text-white/50"', 'text-[10px] text-muted"'],
  ['h-3.5 w-3.5 shrink-0 text-white/40"', 'h-3.5 w-3.5 shrink-0 text-muted"'],
  // Divider
  ['hidden w-px self-stretch bg-white/12 sm:block', 'hidden w-px self-stretch bg-border sm:block'],
  // Query field
  ['<Search className="h-4 w-4 shrink-0 text-white/45" />', '<Search className="h-4 w-4 shrink-0 text-muted" />'],
  ['bg-transparent text-sm text-white placeholder:text-white/40 outline-none',
   'bg-transparent text-sm text-fg placeholder:text-muted outline-none'],
  // GPS spinner/pin -> brand
  ['<Loader2 className="h-4 w-4 shrink-0 animate-spin text-go" />', '<Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />'],
  ['<MapPin className="h-4 w-4 shrink-0 text-go" />', '<MapPin className="h-4 w-4 shrink-0 text-brand" />'],
];

const missed = [];
for (const [from, to] of swaps) {
  if (!block.includes(from)) { missed.push(from.slice(0, 55)); continue; }
  block = block.split(from).join(to);
}

lines.splice(START, END - START, ...block.split("\n"));
fs.writeFileSync(P, lines.join("\n"));

console.log(`changed: ${before !== block}`);
console.log(`missed: ${missed.length}`);
for (const m of missed) console.log("   ! " + m);
console.log(`text-white left in hero block: ${(block.match(/text-white/g) || []).length}`);
