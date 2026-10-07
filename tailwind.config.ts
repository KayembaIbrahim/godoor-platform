import type { Config } from "tailwindcss";

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
        
        /* NEW GoDoor 2.0: Purple visual language */
        purple: "rgb(var(--rgb-purple) / <alpha-value>)",
        "purple-hover": "rgb(var(--rgb-purple-hover) / <alpha-value>)",
        "purple-light": "rgb(var(--rgb-purple-light) / <alpha-value>)",
        "purple-muted": "rgb(var(--rgb-purple-muted) / <alpha-value>)",
        "purple-dark": "rgb(var(--rgb-purple-dark) / <alpha-value>)",
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