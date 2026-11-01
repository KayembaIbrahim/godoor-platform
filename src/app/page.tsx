import { getServiceClient } from "@/lib/supabase-server";
import { readWelcomeBackground } from "@/lib/welcome-bg-server";
import { WelcomeScreen, type WelcomeBackground } from "@/components/WelcomeScreen";
import { AppFooter } from "@/components/AppFooter";
import { redirect } from "next/navigation";

export const revalidate = 60;

/**
 * Sends unauthenticated visitors straight to the onboarding role-picker
 * rather than showing them a generic welcome / sign-in page.  Authenticated
 * (onboarded) users still see the dashboard‑entry welcome screen.
 */
export default async function WelcomePage() {
  const sb = getServiceClient();

  // If the visitor isn’t signed in, redirect to the onboarding flow
  const { data } = await sb.auth.getUser();
  if (!data?.user) {
    redirect("/onboarding");
  }

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

  return (
    <>
      <WelcomeScreen initialBackground={background} />
      <AppFooter />
    </>
  );
}
