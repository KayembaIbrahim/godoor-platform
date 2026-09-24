import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        fg: "var(--color-fg)",
        surface: "var(--color-surface)",
        elevated: "var(--color-elevated)",
        panel: "var(--color-panel)",
        primary: "var(--color-primary)",
        "primary-2": "var(--color-primary-2)",
        go: "var(--color-go)",
        "go-2": "var(--color-go-2)",
        muted: "var(--color-muted)",
        dim: "var(--color-dim)",
        border: "var(--color-border)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "1.125rem",
        "2xl": "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
