"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect, useLayoutEffect, useState } from "react";

// `useLayoutEffect` does nothing (and warns) during SSR, so fall back to
// `useEffect` on the server and only use the before-paint variant in the browser.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type Theme = "dark" | "light" | "system";

type ThemeState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "light",
      setTheme: (t) => set({ theme: t }),
    }),
    // v5: white theme default with matching orange — user can switch to dark
    { name: "godoor-theme-v5-white" },
  ),
);

/** Resolves "system" against the OS preference. */
function resolve(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The theme actually in effect, as a boolean.
 *
 * Reads the store for the choice and subscribes to the OS preference for
 * "system" mode, so it stays correct when the user flips their device theme.
 * Safe to call during render: the server pass and the first client pass both
 * see the persisted value, so hydration cannot mismatch.
 */
export function useIsDark(): boolean {
  const theme = useThemeStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [theme]);

  return theme === "system" ? systemDark : theme === "dark";
}

/** Paints the resolved theme onto <html> and the browser chrome. */
function paint(resolved: "dark" | "light") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);

  // Keep the browser chrome in step with the canvas. Values match the
  // `themePreloadScript` in `src/app/layout.tsx` so the two never disagree.
  // Light is a true white and dark is a true black — the previous #F8F7FC /
  // #060B18 pair tinted the Android status bar and the iOS notch a soft
  // lavender-blue in light and a navy-black in dark, which is visible even
  // before a single pixel of page renders.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0A0A0B" : "#FFFFFF");
  }
}

/**
 * Applies the resolved theme class to <html>.
 *
 * Uses `useLayoutEffect` (not `useEffect`) because the pre-paint script in
 * `src/app/layout.tsx` only covers the initial parse. With `reactStrictMode`
 * on, React's dev remount resets <html> to the attributes it manages from JSX,
 * discarding the class the script set; re-applying in a layout effect repairs
 * that before the browser paints.
 */
export function useThemeEffect() {
  const theme = useThemeStore((s) => s.theme);

  useIsomorphicLayoutEffect(() => {
    paint(resolve(theme));
  }, [theme]);

  // Listen for system changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => paint(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
}
