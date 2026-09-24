"use client";

import { useThemeEffect } from "@/lib/theme-store";

/** Client component that applies the persisted theme on mount. */
export function ThemeEffect() {
  useThemeEffect();
  return null;
}
