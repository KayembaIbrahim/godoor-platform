"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";

export type Theme = "dark" | "light" | "system";

type ThemeState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (t) => set({ theme: t }),
    }),
    // v4: dark-orange theme unlocked — dark default, user can switch
    { name: "godoor-theme-v4-dark-orange" },
  ),
);

/**
 * Applies the resolved theme to <html> data-theme attribute.
 * "system" resolves to OS preference.
 */
export function useThemeEffect() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    let resolved = theme;

    if (theme === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    root.setAttribute("data-theme", resolved);

    // Also update meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        resolved === "dark" ? "#0b0712" : "#f8f7fc",
      );
    }
  }, [theme]);

  // Listen for system changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const root = document.documentElement;
      root.setAttribute("data-theme", mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
}
