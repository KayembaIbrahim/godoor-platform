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
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  markOnly?: boolean;
  showWordmark?: boolean;
}) {
  const height = HEIGHT[size];
  const variant = !markOnly && showWordmark ? ART.lockup : ART.mark;
  const intrinsic = variant === ART.lockup ? LOCKUP : MARK;
  const width = Math.round((intrinsic.width / intrinsic.height) * height);

  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src={variant.light}
        alt="GoDoor"
        width={intrinsic.width}
        height={intrinsic.height}
        sizes={`${width}px`}
        style={{ height, width: "auto" }}
        className="dark:hidden"
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
        style={{ height, width: "auto" }}
        className="hidden dark:block"
      />
    </span>
  );
}
