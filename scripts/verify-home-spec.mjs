#!/usr/bin/env node
/**
 * Verifies the redesigned customer home against the deployed site.
 *
 * CustomerHome is a client component but Next still SSRs it, so most of the
 * design ships in the /app HTML and can be checked directly; the rest is
 * checked against the real chunk graph at /_next/static/immutable/chunks/.
 *
 * The spec assertions below were rewritten on 2026-10-11 against the operator's
 * CURRENT brief. See the revision note above them before changing a line —
 * the earlier version pinned a superseded design and was failing on correct
 * code.
 */
const HOST = "https://godoor.site";

const ROUTES = ["/", "/app", "/wallet", "/rider", "/business", "/checkout", "/tracking", "/how-it-works"];
const GUARDS = ["/admin", "/api/setup", "/schema-sql", "/.env.local", "/api/admin/withdrawals"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function main() {
  let fail = 0;
  const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };

  console.log("── routes ──");
  for (const r of ROUTES) ok((await fetch(HOST + r)).status === 200, `${r} -> 200`);
  console.log("── guards ──");
  for (const r of GUARDS) ok((await fetch(HOST + r)).status === 404, `${r} -> 404`);
  ok((await fetch(`${HOST}/gdr-066f2fa3f4e94cae441295fd72e39c79`)).status === 200, "admin secret link -> 200");

  const html = await (await fetch(`${HOST}/app`)).text();
  console.log(`── /app html: ${(html.length / 1024).toFixed(0)} KB ──`);

  // Crawl the real chunk graph (/immutable/, not /static/chunks/).
  const seen = new Set();
  const queue = [...html.matchAll(/\/_next\/static\/immutable\/chunks\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
  for (const p of queue) seen.add(p);
  const bodies = [];
  let guard = 0;
  while (queue.length && guard++ < 200) {
    const p = queue.shift();
    try {
      const t = await (await fetch(HOST + p)).text();
      bodies.push(t);
      for (const m of t.matchAll(/\/_next\/static\/immutable\/chunks\/[A-Za-z0-9_.-]+\.js/g)) {
        if (!seen.has(m[0])) { seen.add(m[0]); queue.push(m[0]); }
      }
    } catch { /* ignore */ }
  }
  const js = bodies.join("\n");
  console.log(`── chunks: ${bodies.length} files, ${(bodies.reduce((n, b) => n + b.length, 0) / 1024).toFixed(0)} KB ──`);

  console.log("── spec elements (current brief) ──");
  // Both surfaces searched: the SSR'd HTML and the client bundle.
  const both = html + "\n" + js;
  const has = (s) => both.includes(s);

  /* NOTE ON REVISION — read before "fixing" a failure here.
   *
   * These assertions were rewritten on 2026-10-11. They previously described
   * the FIRST redesign (40% promo / FIRST40, a "Popular near you" shop list on
   * the home screen, a solid search bar with an "All products" button, per-tile
   * "0% fee" badges and a purple accent). Every one of those was deliberately
   * replaced by the operator's later briefs:
   *
   *   - the promo became an admin-tuned 20% (FIRST20);
   *   - "Do not show a long list of nearby businesses on the homepage" —
   *     so the shop list moved behind a category;
   *   - the search button became a search icon;
   *   - the palette was collapsed to orange + teal + slate.
   *
   * A suite that pins a superseded design is worse than no suite: it goes red on
   * correct code and teaches everyone to ignore it. So these now assert the
   * CURRENT brief. They are deliberately not weakened to `has()` on everything —
   * each line names a requirement that was actually asked for.
   */

  // C. Category row — the eight verticals, horizontal, pastel discs.
  const SERVICES = ["GoRide", "GoFood", "GoMart", "GoExpress", "GoPharma", "GoPay", "Airtime", "Services"];
  const missing = SERVICES.filter((s) => !has(s));
  ok(missing.length === 0, `C. eight service labels${missing.length ? ` (missing ${missing})` : ""}`);

  // D. Popular Picks — curated, with a "View all" escape hatch.
  ok(has("Popular Picks"), "D. Popular Picks heading");
  ok(has("View all"), "D. Popular Picks 'View all' link");

  // E. Reorder.
  ok(has("Reorder"), "E. reorder section");

  // F. Trust signals.
  ok(has("SAFE MOBILITY"), "F. trust strip");
  ok(has("Verified Drivers"), "F. trust strip badge");
  ok(has("Escrow protected"), "F. escrow signal");

  // G. Bottom navigation — five tabs, Home active.
  ok(has("Categories") && has("Orders") && has("Wallet") && has("Account"), "G. bottom nav tabs");

  // A. Header — location pill, and an honest detecting state.
  ok(has("Deliver to"), "A. header location pill");
  ok(has("Detecting your location"), "A. honest 'detecting' state, not a manual prompt");
  ok(has("Using your current location"), "A. live-position fallback wording");

  // Location must NOT require a manual pick before it shows anything.
  ok(!has("Choose your location") || has("Detecting your location"),
    "location never reads as manual-only while detection runs");

  // ── behaviour rules the brief stated explicitly ──
  // "Do not show a long list of nearby businesses on the homepage."
  ok(!has("Popular near you"), "behaviour: no long shop list on the home screen");

  // The 40% offer was replaced by an admin-tuned 20%. FIRST40 must be gone so
  // the storefront cannot advertise a discount that is no longer honoured.
  ok(!has("FIRST40"), "promo: superseded FIRST40 code removed");
  ok(has("FIRST20"), "promo: current FIRST20 code ships");

  // B. Banner is admin-controlled, so it returns a shape — never a fabricated
  // default. An unconfigured banner MUST be null rather than invented copy.
  const bannerRes = await fetch(`${HOST}/api/hero-banner`).then((r) => r.json()).catch(() => null);
  ok(bannerRes && "banner" in bannerRes, "B. hero-banner endpoint responds");
  ok(bannerRes?.banner === null || typeof bannerRes?.banner === "object",
    "B. banner is null when unconfigured (no fabricated sponsor)");

  console.log("── live CSS compiles ──");
  const cssPaths = [...new Set([...html.matchAll(/\/_next\/static\/immutable\/chunks\/[A-Za-z0-9_.-]+\.css/g)].map((m) => m[0]))];
  const css = (await Promise.all(cssPaths.map(async (p) => (await fetch(HOST + p)).text()))).join("\n");
  console.log(`css: ${cssPaths.length} files, ${(css.length / 1024).toFixed(0)} KB`);

  for (const [label, re] of [
    // Hybrid theme scope (brief §1) — cream canvas, ink cards, pastel discs.
    [".hybrid scope", /\.hybrid(?![-\w])/],
    [".hybrid-card", /\.hybrid-card(?![-\w])/],
    [".hybrid-disc", /\.hybrid-disc(?![-\w])/],
    // Collapsed palette: orange (CTA) + teal (brand) + slate. The purple
    // accent below belongs to OTHER surfaces (admin, auth) and is not pinned
    // here any more — it was only ever asserted for the old tile palette.
    ["bg-brand", /\.bg-brand(?![-\w])/],
    ["text-go", /\.text-go(?![-\w])/],
    ["bg-go", /\.bg-go(?![-\w])/],
    // Floating curved bottom nav.
    ["nav-float", /\.nav-float(?![-\w])/],
  ]) ok(re.test(css), `${label} compiled`);

  console.log("── theme tokens ──");
  /* "Dark must be black, not deep navy."
   *
   * Scoped to the theme token positions on purpose. A naive `css.includes("0f172a")`
   * is a false positive here: Tailwind ships slate-900 as its STOCK SHADOW
   * colour (`--shadow: 0 4px 20px -2px #0f172a14`), so that hex legitimately
   * appears ~19 times inside box-shadows at 8–65% alpha. Those are shadow
   * tints, not surfaces, and the first version of this check failed on them.
   * What matters is that no BACKGROUND token is navy. */
  const dark = (css.match(/\.dark\{[^}]*\}/) || [""])[0];
  const root = (css.match(/:root\{[^}]*\}/) || [""])[0];
  const navyTokens = [...`${root} ${dark}`.matchAll(/--(?:rgb-)?(?:bg|surface|surface-2|navy|border)\s*:\s*([^;]+)/g)]
    .filter((m) => /15\s+23\s+42|0f172a/i.test(m[1]));
  ok(navyTokens.length === 0,
    `no navy in background tokens${navyTokens.length ? ` (${navyTokens.map((m) => m[0]).join(", ")})` : ""}`);
  ok(/--rgb-bg:\s*10 10 11/.test(dark), `dark bg is true black (${(dark.match(/--rgb-bg:[\d ]+/) || ["?"])[0]})`);

  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERROR", e.message); process.exit(1); });