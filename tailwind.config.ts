import type { Config } from "tailwindcss";
import defaultColors from "tailwindcss/colors";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      /* ─── Color tokens ───
         Each colour resolves to rgb(var(--rgb-x) / <alpha-value>) in CSS.
         Opacity and spacing values added for app-specific needs.
         Purple tokens added for GoDoor 2.0 visual identity. */
      colors: {
        /* Brand / GoDoor orange (primary brand) */
        bg: "rgb(var(--rgb-bg) / <alpha-value>)",
        fg: "rgb(var(--rgb-text) / <alpha-value>)",
        surface: "rgb(var(--rgb-surface) / <alpha-value>)",
        elevated: "rgb(var(--rgb-surface-2) / <alpha-value>)",
        panel: "rgb(var(--rgb-primary-light) / <alpha-value>)",
        primary: "rgb(var(--rgb-primary) / <alpha-value>)",
        "primary-2": "rgb(var(--rgb-primary-hover) / <alpha-value>)",
        go: "rgb(var(--rgb-primary) / <alpha-value>)",
        "go-2": "rgb(var(--rgb-primary-hover) / <alpha-value>)",
        muted: "rgb(var(--rgb-text-muted) / <alpha-value>)",
        dim: "rgb(var(--rgb-text-muted) / <alpha-value>)",
        border: "rgb(var(--rgb-border) / <alpha-value>)",
        success: "rgb(var(--rgb-success) / <alpha-value>)",
        warning: "rgb(var(--rgb-warning) / <alpha-value>)",
        danger: "rgb(var(--rgb-danger) / <alpha-value>)",
        navy: "rgb(var(--rgb-navy) / <alpha-value>)",
        "navy-hover": "rgb(var(--rgb-navy-hover) / <alpha-value>)",
        "navy-deep": "rgb(var(--rgb-navy-deep) / <alpha-value>)",
        "navy-soft": "rgb(var(--rgb-navy-soft) / <alpha-value>)",

        /* Brand teal — identity surfaces (nav, badges, hero, live states).
           Kept separate from `primary`/`go`, which stay GoDoor orange and
           own every call-to-action. */
        brand: "rgb(var(--rgb-brand) / <alpha-value>)",
        "brand-hover": "rgb(var(--rgb-brand-hover) / <alpha-value>)",
        "brand-light": "rgb(var(--rgb-brand-light) / <alpha-value>)",
        "brand-deep": "rgb(var(--rgb-brand-deep) / <alpha-value>)",

        /* Selection orange — the colour that marks a SELECTED nav item, a
           selected control or a hoverable utility button. It is the same
           orange as `primary`/`go`, exposed under its own name so the
           "selected" meaning is readable at the call site. */
        accent: "rgb(var(--rgb-accent-orange) / <alpha-value>)",
        "accent-deep": "rgb(var(--rgb-accent-orange-deep) / <alpha-value>)",
        "accent-light": "rgb(var(--rgb-accent-orange-light) / <alpha-value>)",
        info: "rgb(var(--rgb-info) / <alpha-value>)",
        "info-hover": "rgb(var(--rgb-info-hover) / <alpha-value>)",
        "info-light": "rgb(var(--rgb-info-light) / <alpha-value>)",

        /* ─── Page canvas + ink cards ──────────────────────────────────────────
           `canvas` is the page surface and simply mirrors the theme — white
           in light, black in dark — so the customer home follows the
           customer's own light/dark choice instead of forcing itself light.
           `ink*` are the dark cards (location pill, service tiles, modals),
           which stay dark in BOTH themes; in dark mode they are a raised
           near-black sitting above a near-black canvas rather than the same
           near-black as it. `on-ink*` is the light text that sits on them —
           which is why they are separate tokens: text colour on a card
           depends on the card, so it cannot be inferred from the page. */
        canvas: "rgb(var(--rgb-canvas) / <alpha-value>)",
        "canvas-2": "rgb(var(--rgb-canvas-2) / <alpha-value>)",
        ink: "rgb(var(--rgb-ink) / <alpha-value>)",
        "ink-2": "rgb(var(--rgb-ink-2) / <alpha-value>)",
        "ink-3": "rgb(var(--rgb-ink-3) / <alpha-value>)",
        "on-ink": "rgb(var(--rgb-on-ink) / <alpha-value>)",
        "on-ink-muted": "rgb(var(--rgb-on-ink-muted) / <alpha-value>)",
        hairline: "rgb(var(--rgb-hairline) / <alpha-value>)",
        
        /* NEW GoDoor 2.0: Purple visual language.
           `purple` must be an OBJECT, not a bare string. Assigning a string
           replaces Tailwind's whole default purple scale, so `purple-500` and
           friends would silently compile to nothing. `DEFAULT` keeps the
           un-suffixed `bg-purple` working alongside the stock ramp. */
        purple: {
          DEFAULT: "rgb(var(--rgb-purple) / <alpha-value>)",
          hover: "rgb(var(--rgb-purple-hover) / <alpha-value>)",
          dark: "rgb(var(--rgb-purple-dark) / <alpha-value>)",
          light: "rgb(var(--rgb-purple-light) / <alpha-value>)",
          muted: "rgb(var(--rgb-purple-muted) / <alpha-value>)",
          ...defaultColors.purple,
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "1.125rem",
        "2xl": "1.5rem",
      },
      opacity: {
        8: "0.08",
        12: "0.12",
        85: "0.85",
      },
      spacing: {
        "4.5": "1.125rem",
        "5.5": "1.375rem",
        "9.5": "2.375rem",
        "10.5": "2.625rem",
      },
    },
  },
  plugins: [],
};

export default config;