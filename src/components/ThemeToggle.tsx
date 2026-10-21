"use client";

import { useThemeStore } from "@/lib/theme-store";
import { useHydrated } from "@/lib/use-hydrated";
import { Sun, Moon, Monitor } from "lucide-react";

/**
 * Cycles light → dark → system, so every preference stays reachable.
 *
 * `inBar` renders the control as an ITEM of the black utility capsule
 * (`.icon-bar`) rather than as a standalone button. The bar's own item
 * styling supplies the ink and the hover fill, so the control's usual
 * `text-muted` / `hover:bg-elevated` utilities are dropped — muted grey is
 * nearly invisible against the black capsule, and the light hover fill
 * flashes white across a dark surface.
 */
export function ThemeToggle({ inBar = false }: { inBar?: boolean } = {}) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  /* The theme is persisted to localStorage and rehydrated synchronously, so
     the client knows the user's theme on its first render while the server
     only ever knows "light". Rendering the persisted theme's icon immediately
     would make the two trees disagree. The icon waits for hydration — the
     page itself is already themed by the pre-paint script in the layout, so
     nothing flickers. */
  const hydrated = useHydrated();

  /* The theme the *server* rendered, and therefore the theme the first client
     render must also produce. Every part of this button — icon, aria-label
     and title — has to be derived from this one value, otherwise a user with
     a persisted dark theme gets a mismatched attribute and React throws #418. */
  const shown = hydrated ? theme : "light";

  const nextTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const themeIcon = () => {
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
      className={
        inBar
          ? "icon-bar-item tap-44 transition active:scale-90"
          : "tap-44 grid h-10 w-10 place-items-center rounded-full text-muted transition hover:bg-elevated hover:text-fg active:scale-95"
      }
      aria-label={`Switch to ${shown === "light" ? "dark" : shown === "dark" ? "system" : "light"} mode`}
      title={`Current: ${shown} mode. Click to cycle.`}
    >
      {themeIcon()}
    </button>
  );
}
