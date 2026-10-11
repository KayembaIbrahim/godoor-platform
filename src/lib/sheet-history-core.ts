/**
 * Sheet history state machine.
 *
 * No React and no real `window`, so the balance rules can be tested directly.
 * `useSheetHistory` is a thin binding around this.
 *
 * The rule being enforced: at most one history entry is ever pushed for a sheet,
 * and it is always consumed. A leaked entry means the user presses Back and
 * nothing visible happens; a double-consume means Back skips past the page the
 * user came from.
 */

export const SHEET_STATE = "__godoorSheet";

type HistoryLike = {
  pushState(state: unknown, title: string): void;
  back(): void;
};

export type SheetWindow = {
  history: HistoryLike;
  addEventListener(type: "popstate", fn: () => void): void;
  removeEventListener(type: "popstate", fn: () => void): void;
};

export function createSheetHistory(win: SheetWindow, onClose: () => void) {
  let pushed = false;
  let listening = false;

  const onPop = () => {
    // This pop already consumed our entry — close, but do not call back()
    // again, which would eat the page the user came from.
    pushed = false;
    detach();
    onClose();
  };

  const attach = () => {
    if (listening) return;
    listening = true;
    win.addEventListener("popstate", onPop);
  };

  const detach = () => {
    if (!listening) return;
    listening = false;
    win.removeEventListener("popstate", onPop);
  };

  return {
    /** Called when the sheet opens. Idempotent: a re-render must not push twice. */
    open(): void {
      if (pushed) {
        attach();
        return;
      }
      pushed = true;
      win.history.pushState({ [SHEET_STATE]: true }, "");
      attach();
    },

    /** User-initiated close (Back, Escape, the X). Consumes our own entry. */
    dismiss(): void {
      if (pushed) {
        pushed = false;
        // popstate then fires and performs the close.
        win.history.back();
        return;
      }
      detach();
      onClose();
    },

    /** The sheet closed by another route — authorised, or the parent reset.
     *  Drop our entry so Back does not walk through a dead sheet entry. */
    dropped(): void {
      detach();
      if (!pushed) return;
      pushed = false;
      win.history.back();
    },

    /** Test/diagnostic: is an entry of ours currently on the stack? */
    hasEntry(): boolean {
      return pushed;
    },
  };
}

export type SheetHistory = ReturnType<typeof createSheetHistory>;