"use client";

import { useCallback, useEffect, useRef } from "react";
import { createSheetHistory } from "@/lib/sheet-history-core";

/**
 * Give a modal sheet a history entry, so the device Back button closes the
 * sheet instead of leaving the page.
 *
 * Without this, the wallet PIN sheet opened on `/wallet` had no history entry:
 * pressing Back on an Android phone navigated straight out to the customer home
 * screen (`/app`) and threw away whatever the user had typed. That reads as
 * "the security sheet stacks and dumps me back on the home screen".
 *
 * Returns a `dismiss` callback that closes the sheet by consuming the entry we
 * pushed, so the back stack does not accumulate dead entries the user then has
 * to press Back through. The balance rules live in `sheet-history-core` so they
 * can be tested without a DOM.
 */
export function useSheetHistory(open: boolean, onClose: () => void): () => void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const ctlRef = useRef<ReturnType<typeof createSheetHistory> | null>(null);
  if (ctlRef.current === null && typeof window !== "undefined") {
    ctlRef.current = createSheetHistory(
      {
        history: window.history,
        addEventListener: (t, fn) => window.addEventListener(t, fn),
        removeEventListener: (t, fn) => window.removeEventListener(t, fn),
      },
      () => closeRef.current(),
    );
  }

  useEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl || !open) return;
    ctl.open();
  }, [open]);

  // Closed by another route — authorised, or the parent reset its state. Drop
  // our entry so Back does not have to walk through a dead sheet entry.
  useEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl || open) return;
    ctl.dropped();
  }, [open]);

  return useCallback(() => {
    const ctl = ctlRef.current;
    if (!ctl) {
      closeRef.current();
      return;
    }
    ctl.dismiss();
  }, []);
}