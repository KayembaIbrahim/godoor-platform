/**
 * Sheet history balance rules.
 *
 * The defect being fixed: the wallet PIN sheet had no history entry, so Back on
 * a phone navigated out to the customer home screen. The fix pushes one — which
 * creates two new ways to get it wrong:
 *   - a leaked entry  → Back does nothing visible
 *   - a double consume → Back skips past the page the user came from
 *
 * Runs the real `sheet-history-core` against a fake stack that models the real
 * one: back() pops the current entry and fires popstate.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd()}/scripts/`));

const { createSheetHistory } = await import("../src/lib/sheet-history-core.ts");

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

/** A history stack deep enough to see a double-consume skip a real page. */
function fakeWindow(depth = 1) {
  const stack = new Array(depth).fill({ page: true });
  const listeners = new Set();
  const calls = { pushes: 0, backs: 0 };
  return {
    stack,
    calls,
    win: {
      history: {
        pushState(state) {
          calls.pushes++;
          stack.push(state);
        },
        back() {
          calls.backs++;
          const popped = stack.pop();
          for (const fn of [...listeners]) fn(popped);
        },
      },
      addEventListener: (_t, fn) => listeners.add(fn),
      removeEventListener: (_t, fn) => listeners.delete(fn),
    },
    /** The user pressing the device Back button. */
    pressBack() {
      const popped = stack.pop();
      for (const fn of [...listeners]) fn(popped);
    },
  };
}

console.log("\n=== sheet history balance ===\n");

console.log("[1] Back closes the sheet instead of leaving the page");
{
  const f = fakeWindow();
  let closed = 0;
  const ctl = createSheetHistory(f.win, () => closed++);
  ctl.open();
  check("pushed one entry", f.calls.pushes, 1);
  check("stack grew", f.stack.length, 2);
  f.pressBack();
  check("sheet closed", closed, 1);
  check("page underneath untouched", f.stack.length, 1);
  check("no leftover entry", ctl.hasEntry(), false);
}

console.log("[2] open() is idempotent — a re-render must not push twice");
{
  const f = fakeWindow();
  const ctl = createSheetHistory(f.win, () => {});
  ctl.open();
  ctl.open();
  ctl.open();
  check("pushes", f.calls.pushes, 1);
  check("depth", f.stack.length, 2);
}

console.log("[3] dismiss() consumes exactly one entry (no double-consume)");
{
  const f = fakeWindow();
  let closed = 0;
  const ctl = createSheetHistory(f.win, () => closed++);
  ctl.open();
  ctl.dismiss();
  check("backs", f.calls.backs, 1);
  check("closed exactly once", closed, 1);
  check("stack back to depth", f.stack.length, 1);
  // A second dismiss must not eat the page underneath.
  ctl.dismiss();
  check("second dismiss does not pop the page", f.stack.length, 1);
}

console.log("[4] a sheet closed by another route drops its entry");
{
  const f = fakeWindow();
  let closed = 0;
  const ctl = createSheetHistory(f.win, () => closed++);
  ctl.open();
  ctl.dropped(); // e.g. the PIN was accepted
  check("entry consumed", f.stack.length, 1);
  check("did not also close", closed, 0);
}

console.log("[5] dropped() with no entry is a no-op");
{
  const f = fakeWindow();
  let closed = 0;
  const ctl = createSheetHistory(f.win, () => closed++);
  ctl.dropped();
  check("no push", f.calls.pushes, 0);
  check("no back", f.calls.backs, 0);
  check("no close", closed, 0);
  check("stack intact", f.stack.length, 1);
}

console.log("[6] reopen after close works — the parent may reuse the sheet");
{
  const f = fakeWindow();
  let closed = 0;
  const ctl = createSheetHistory(f.win, () => closed++);
  ctl.open();
  f.pressBack();
  ctl.open();
  check("pushed again", f.calls.pushes, 2);
  check("closed once so far", closed, 1);
  f.pressBack();
  check("closed twice", closed, 2);
  check("never grew the stack", f.stack.length, 1);
}

console.log("[7] popstate listener is removed once closed (no leak)");
{
  const f = fakeWindow();
  const ctl = createSheetHistory(f.win, () => {});
  ctl.open();
  ctl.dismiss();
  const before = f.calls.backs;
  f.pressBack();
  check("no extra back from a stale listener", f.calls.backs, before);
}

console.log(`\npassed ${pass}  failed ${fail}\n`);
process.exit(fail ? 1 : 0);