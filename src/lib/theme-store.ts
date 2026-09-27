"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect, useLayoutEffect } from "react";

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
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Paints the resolved theme onto <html> and the browser chrome. */
function paint(resolved: "dark" | "light") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);

  // Keep the browser chrome in step with the canvas. Values match the
  // `themePreloadScript` in `src/app/layout.tsx` so the two never disagree.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#060B18" : "#F8F7FC");
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
