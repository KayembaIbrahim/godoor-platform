/**
 * Order-alert dedup.
 *
 * Imports the REAL module rather than a re-implementation — an earlier pass in
 * this session "passed" a test against a copy of the code and proved nothing.
 *
 * The claim: a customer gets exactly one alert per real status change — no
 * duplicates from Postgres UPDATE chatter, and no burst of stale alerts when the
 * hook mounts while an order is already in flight.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd()}/scripts/`));

const { decideTransition, labelForStatus } = await import("../src/lib/notification-core.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};
const fresh = () => ({ last: new Map(), ann: new Set() });

console.log("\n=== notification dedup (real notification-core module) ===\n");

console.log("[1] a real transition is announced exactly once");
{
  const { last, ann } = fresh();
  last.set("o1", "pending");
  check("first change announces", decideTransition(last, ann, "o1", "payment_confirmed").announce, true);
  check("repeat is silent", decideTransition(last, ann, "o1", "payment_confirmed").announce, false);
  check("repeat again is silent", decideTransition(last, ann, "o1", "payment_confirmed").announce, false);
}

console.log("[2] mounting mid-journey announces nothing stale");
{
  const { last, ann } = fresh();
  last.set("o1", "delivering");
  check("same status on arrival is silent", decideTransition(last, ann, "o1", "delivering").announce, false);
  check("next real step still announces", decideTransition(last, ann, "o1", "delivered").announce, true);
}

console.log("[3] orders do not bleed into each other");
{
  const { last, ann } = fresh();
  last.set("o1", "preparing");
  last.set("o2", "preparing");
  check("o1 change", decideTransition(last, ann, "o1", "delivering").announce, true);
  check("o2 change", decideTransition(last, ann, "o2", "delivering").announce, true);
  check("o1 unchanged (unrelated UPDATE)", decideTransition(last, ann, "o1", "delivering").announce, false);
}

console.log("[4] empty / missing status never announces");
{
  const { last, ann } = fresh();
  last.set("o1", "pending");
  check("empty string", decideTransition(last, ann, "o1", "").announce, false);
  check("undefined", decideTransition(last, ann, "o1", undefined).announce, false);
}

console.log("[5] a status can recur after moving on");
{
  const { last, ann } = fresh();
  last.set("o1", "preparing");
  decideTransition(last, ann, "o1", "delivering");
  check("back to preparing announces again", decideTransition(last, ann, "o1", "preparing").announce, true);
}

console.log("[6] labels read as English, never raw underscores");
{
  check("medicines_ready", labelForStatus("medicines_ready"), "Ready for pickup");
  check("payment_confirmed", labelForStatus("payment_confirmed"), "Payment confirmed");
  check("delivering", labelForStatus("delivering"), "On the way");
  check("unknown status falls back", labelForStatus("brand_new_status"), "brand new status");
}

console.log(`\npassed ${pass}  failed ${fail}\n`);
process.exit(fail ? 1 : 0);