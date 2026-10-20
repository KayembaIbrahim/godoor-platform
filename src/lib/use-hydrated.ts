"use client";
import { useEffect, useLayoutEffect, useState } from "react";

/**
 * `useLayoutEffect` does nothing (and warns) during SSR, so fall back to
 * `useEffect` on the server and only use the before-paint variant in the browser.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * True once React has hydrated on the client.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several stores in this app are persisted to `localStorage` by Zustand, and
 * Zustand rehydrates them SYNCHRONOUSLY when the store is created. So on the
 * very first client render the store already knows the user is signed in —
 * while the server, which cannot read `localStorage`, rendered the signed-out
 * version of the same component. The two trees disagreed, and React threw
 * hydration error #418 ("server rendered HTML didn't match the client").
 *
 * React's response to that is to throw away the ENTIRE server-rendered tree
 * and regenerate it on the client. That is expensive and visible: the
 * server-rendered welcome artwork disappears and reappears, first paint is
 * delayed, and every interactive element in the discarded tree has to be
 * re-wired. It was the reason the homepage felt slow and the published
 * background kept failing to show.
 *
 * THE FIX
 * -------
 * Render the *same* markup on the server and on the first client render, and
 * only reveal the session-dependent version once React has hydrated. Because
 * this hook uses a layout effect, the swap happens BEFORE the browser paints,
 * so a signed-in user never sees a flash of the signed-out markup and the
 * header does not shift.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useIsomorphicLayoutEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}

/** The same hook, exported for components that need the effect itself. */
export { useIsomorphicLayoutEffect };
