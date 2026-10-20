import { getServiceClient } from "@/lib/supabase-server";
import { readWelcomeBackground } from "@/lib/welcome-bg-server";
import { WelcomeScreen, type WelcomeBackground } from "@/components/WelcomeScreen";

/**
 * GoDoor Welcome Page — app-style entry screen (version 10.5.1).
 *
 * Replaces the long marketing landing page with a true app shell:
 *   1. the GoDoor logo and wordmark, prominent and centred;
 *   2. an admin-customisable background image, read from the database HERE,
 *      on the server, and handed to the client component as a prop — so the
 *      artwork is in the very first byte of HTML the visitor receives;
 *   3. a prominent glass-effect Explore button — the single action every
 *      unauthenticated visitor takes first;
 *   4. sign in / create account, which open the shared auth dialog
 *      (the same one the header uses, so the credential handling cannot
 *      drift out of sync).
 *
 * All previous marketing content now lives on /explore, so this screen reads
 * as the app's home rather than a story page.
 *
 * ── Why the background is read on the server ───────────────────────────────
 * The background used to be fetched from `/api/welcome-bg` inside a client
 * component, after mount. That meant the first paint showed the plain
 * gradient and the admin's artwork appeared a second or two later — on a slow
 * phone it looked as though publishing had simply not worked. Reading it here
 * puts the image URL straight into the server-rendered HTML, so it is there
 * from the first paint, and the client-side refresh is kept only as a
 * belt-and-braces update for a background published while the tab was open.
 *
 * `force-dynamic` keeps this honest: the page must be rendered per request,
 * never prerendered at build time, or a background published after the build
 * would never reach the live site.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const sb = getServiceClient();
  const stored = await readWelcomeBackground(sb);

  // Only a PUBLISHED background reaches visitors. A draft preview made in the
  // admin portal stays in the admin portal.
  const background: WelcomeBackground | null = stored.published
    ? {
        imageUrl: stored.imageUrl,
        intensity: stored.intensity,
        slides: stored.slides,
        slideDurationMs: stored.slideDurationMs,
      }
    : null;

  return <WelcomeScreen initialBackground={background} />;
}
