import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * GoDoor logo, rendered from the official brand artwork.
 *
 * The source logo is navy on transparency, which disappears on the app's dark
 * canvas, so a light-on-dark twin is generated from the same source by
 * `scripts/build-brand-assets.mjs`. Both variants are always in the DOM and
 * the active theme is picked with Tailwind's `dark:` variants, so the correct
 * one is on screen from the first paint — no flash, no client JS, and no
 * hydration mismatch from reading the theme store during render.
 *
 * Regenerate the artwork with: node scripts/build-brand-assets.mjs
 */

/** Intrinsic size of `public/brand/godoor-logo.png` (the mark + wordmark). */
const LOCKUP = { width: 1200, height: 299 } as const;
/** Intrinsic size of `public/brand/godoor-mark.png` (the mark alone). */
const MARK = { width: 471, height: 494 } as const;

/** Rendered height in px, keeping the previous visual scale of this component. */
const HEIGHT = { sm: 24, md: 30, lg: 40 } as const;

const ART = {
  lockup: { light: "/brand/godoor-logo.png", dark: "/brand/godoor-logo-dark.png" },
  mark: { light: "/brand/godoor-mark.png", dark: "/brand/godoor-mark-dark.png" },
} as const;

export function Logo({
  className,
  size = "md",
  markOnly = false,
  showWordmark = true,
  surface = "auto",
  maxWidth,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  markOnly?: boolean;
  showWordmark?: boolean;
  /**
   * Cap the rendered width, letting the artwork scale down PROPORTIONALLY.
   *
   * The lockup is 4:1, so at the "sm" height it is 96px wide — a third of a
   * 360px phone's header row, and the reason the account controls had nowhere
   * to breathe. Passing a cap here shrinks the artwork to fit instead of
   * letting it push the controls off the edge. `width:auto` with `height:auto`
   * and a `max-width` keeps the aspect ratio intact (a fixed height plus a
   * capped width would squash the wordmark).
   */
  maxWidth?: number;
  /**
   * The background this logo actually sits on.
   *
   * `auto` follows the global light/dark theme, which is right almost
   * everywhere. It is wrong on the hybrid customer home: that screen paints
   * a warm cream page (`.hybrid`) while `<html>` still carries whatever
   * theme the customer picked. Someone on the dark theme therefore got the
   * NEAR-WHITE artwork drawn on a cream background — a white logo on
   * off-white, i.e. invisible. Pass `light` there and the navy artwork is
   * used regardless of the theme class.
   *
   * Purely className-driven, so there is no client JS and no hydration risk.
   */
  surface?: "auto" | "light" | "dark";
}) {
  const height = HEIGHT[size];
  const variant = !markOnly && showWordmark ? ART.lockup : ART.mark;
  const intrinsic = variant === ART.lockup ? LOCKUP : MARK;
  const width = Math.round((intrinsic.width / intrinsic.height) * height);

  const forceLight = surface === "light";
  const forceDark = surface === "dark";

  // When the surface is known, drop the theme variant entirely: show exactly
  // one image rather than relying on which class happens to win.
  const navyClass = forceDark ? "hidden" : forceLight ? "" : "dark:hidden";
  const whiteClass = forceLight ? "hidden" : forceDark ? "" : "hidden dark:block";

  /* A capped logo scales PROPORTIONALLY: with `height:auto` the browser keeps
     the intrinsic ratio and derives the other axis from the cap. */
  const imgStyle: React.CSSProperties = maxWidth
    ? { maxWidth, width: "auto", height: "auto" }
    : { height, width: "auto" };

  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src={variant.light}
        alt="GoDoor"
        width={intrinsic.width}
        height={intrinsic.height}
        sizes={`${width}px`}
        style={imgStyle}
        className={navyClass || undefined}
      />
      {/* Same artwork with the navy lifted to near-white; hidden from
          assistive tech because the light variant above already names it. */}
      <Image
        src={variant.dark}
        alt=""
        aria-hidden
        width={intrinsic.width}
        height={intrinsic.height}
        sizes={`${width}px`}
        style={imgStyle}
        className={whiteClass || undefined}
      />
    </span>
  );
}

export const GoDoorLogo = Logo;
