import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { ThemeEffect } from "@/components/ThemeEffect";
import { HeaderClient } from "@/components/HeaderClient";
import { ClientProviders } from "@/components/ClientProviders";
import { AppFooter } from "@/components/AppFooter";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#faf7f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`} data-theme="light">
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
