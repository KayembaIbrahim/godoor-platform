import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },

  /**
   * Next 16 blocks dev-only resources from origins it does not recognise by
   * default, and the browser suite drives the app over `http://127.0.0.1:<port>`
   * (all its tests run locally). Without these the HMR socket comes back 403,
   * which made the dev server look broken in the browser while pages served OK.
   * These are development-only origins. Nothing here affects production builds.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  /**
   * No `browserslist` here on purpose.
   *
   * A performance audit flagged a 41 KB chunk containing core-js shims and
   * runtime sniffing for DENO / Bun / Cloudflare as "a blocking script on every
   * page". It is not. The tag is
   *
   *   <script src=".../0c0hxoamwjsbw.js" noModule="">
   *
   * and `noModule` means any browser that supports ES modules — which is every
   * browser in GoDoor's install base, and the exact browsers the Next docs
   * target by default (chrome 111, safari 16.4) — skips the download entirely.
   * It only executes on legacy engines. Raising the browserslist floor would
   * therefore have changed nothing on any device a real user owns, while
   * looking like a 41 KB win in the numbers.
   *
   * The genuinely large items found by the audit were handled where they
   * actually were: the Capacitor geolocation bridge is now a dynamic import in
   * src/lib/location.ts, so web visitors never download it.
   */

  images: {
    // Merchant logos, product photos and avatars are served from Supabase
    // Storage. Without these patterns they cannot go through next/image, which
    // is why 19 raw <img> tags were bypassing optimisation.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "*.supabase.in", pathname: "/storage/v1/object/public/**" },
    ],
    formats: ["image/avif", "image/webp"],
  },

  // Cloudflare Pages / Next-on-Pages compatibility
  output: "standalone",
};

export default nextConfig;
