"use client";

import { useThemeStore } from "@/lib/theme-store";
import { useHydrated } from "@/lib/use-hydrated";
import { Sun, Moon, Monitor } from "lucide-react";

/** Cycles light → dark → system, so every preference stays reachable. */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  /* The theme is persisted to localStorage and rehydrated synchronously, so
     the client knows the user's theme on its first render while the server
     only ever knows "light". Rendering the persisted theme's icon immediately
     would make the two trees disagree. The icon waits for hydration — the
     page itself is already themed by the pre-paint script in the layout, so
     nothing flickers. */
  const hydrated = useHydrated();

  const nextTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const themeIcon = () => {
    // Before hydration, show the same icon the server rendered.
    const shown = hydrated ? theme : "light";
    switch (shown) {
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
      className="tap-44 grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-elevated hover:text-fg active:scale-95"
      aria-label={`Switch to ${theme === "light" ? "dark" : theme === "dark" ? "system" : "light"} mode`}
      title={`Current: ${theme} mode. Click to cycle.`}
    >
      {themeIcon()}
    </button>
  );
}
