"use client";

import { useThemeStore } from "@/lib/theme-store";
import { Sun, Moon, Monitor } from "lucide-react";

/** Cycles light → dark → system, so every preference stays reachable. */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const nextTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const themeIcon = () => {
    switch (theme) {
      case "light":
        return <Sun className="h-4 w-4" />;
      case "dark":
        return <Moon className="h-4 w-4" />;
      case "system":
        return <Monitor className="h-4 w-4" />;
    }
  };

  return (
    <button
      type="button"
      onClick={nextTheme}
      className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted transition hover:bg-elevated hover:text-fg active:scale-95"
      aria-label={`Switch to ${theme === "light" ? "dark" : theme === "dark" ? "system" : "light"} mode`}
      title={`Current: ${theme} mode. Click to cycle.`}
    >
      {themeIcon()}
    </button>
  );
}
