import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeEffect } from "@/components/ThemeEffect";
import { HeaderClient } from "@/components/HeaderClient";
import { ClientProviders } from "@/components/ClientProviders";
import { AppFooter } from "@/components/AppFooter";

export const metadata: Metadata = {
  title: "GoDoor — Delivering Possibilities",
  description:
    "Hyper-local delivery platform for Uganda. Food, groceries, pharmacy & packages — delivered to your door. Pay with MTN MoMo or Airtel Money.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "GoDoor — Your City. Your Door.",
    description: "Order food, groceries, pharmacy & packages. Delivered to your door in minutes. Pay with MoMo.",
    siteName: "GoDoor",
    type: "website",
    url: "https://godoor.site",
  },
  twitter: {
    card: "summary_large_image",
    title: "GoDoor — Delivering Possibilities",
    description: "Food, groceries, pharmacy & packages delivered to your door. Pay with MTN MoMo or Airtel Money.",
  },
};

/**
 * Pre-paint theme resolution.
 *
 * `useThemeEffect` can only run after hydration, so without this the server
 * markup (`class="light"`) would paint first and dark-mode users would get a
 * white flash on every page load. This reads the same persisted key zustand
 * uses and applies the class before the browser paints any body content.
 *
 * Kept in sync with `src/lib/theme-store.ts` (storage key + light/dark tokens).
 */
const themePreloadScript = `
(function () {
  try {
    var raw = localStorage.getItem("godoor-theme-v5-white");
    var stored = raw ? JSON.parse(raw) : null;
    var theme = (stored && stored.state && stored.state.theme) || "light";
    var resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    var root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#060B18" : "#F8F7FC");
  } catch (e) {}
})();
`.trim();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#F8F7FC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script rewrites the class on <html>, so React must accept the DOM as-is.
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeEffect />
        <HeaderClient />
        <ClientProviders>
          <main className="min-h-0">{children}</main>
        </ClientProviders>
        <AppFooter />
      </body>
    </html>
  );
}
