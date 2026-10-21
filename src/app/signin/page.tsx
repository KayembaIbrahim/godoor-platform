import { getServiceClient } from "@/lib/supabase-server";
import { readWelcomeBackground } from "@/lib/welcome-bg-server";
import { SigninShell } from "@/components/SigninShell";
import { type SignInMode } from "@/components/SignInForm";

/**
 * The dedicated "welcome sign in" page — replaces the header auth modal
 * (`HeaderAuth`'s popup). A full-page experience rather than a floating dialog:
 *   - `?mode=signup` opens the create-account form; otherwise login;
 *   - `?next=/path` deep-links back after sign-in (only absolute internal paths);
 *   - on success the user is sent to their role dashboard or `next`.
 *
 * Reading `searchParams` here opts the route into request-time dynamic rendering,
 * which is what we want: the page is only correct for the visitor who opened it,
 * and `searchParams` is a request-time API whose values cannot be known ahead
 * of time.
 *
 * ── Why the background is read on the server ───────────────────────────────
 * The sign-in page shows the SAME admin-published welcome artwork as the home
 * screen, so signing in feels like stepping into the app rather than onto a
 * plain white form. Reading it here puts the image URL straight into the
 * server-rendered HTML, so the artwork is on screen from the first paint
 * instead of appearing a second or two later behind a client fetch.
 *
 * `revalidate = 60` keeps the page cacheable: the artwork changes rarely, and
 * the admin publish route drops the cache when it actually changes.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Sign in | GoDoor",
  description: "Sign in to your GoDoor account to order, track and pay.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const [params, stored] = await Promise.all([
    searchParams,
    readWelcomeBackground(getServiceClient()),
  ]);
  const mode: SignInMode = params.mode === "signup" ? "signup" : "login";
  // Only a PUBLISHED background reaches visitors — a draft preview stays in
  // the admin portal.
  const background = stored.published ? stored : null;
  return <SigninShell background={background} mode={mode} next={params.next} />;
}
