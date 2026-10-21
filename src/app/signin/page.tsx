import { type Metadata } from "next";
import { SignInForm, type SignInMode } from "@/components/SignInForm";

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
 */
export const metadata: Metadata = {
  title: "Sign in | GoDoor",
  description: "Sign in to your GoDoor account to order, track and pay.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const params = await searchParams;
  const mode: SignInMode = params.mode === "signup" ? "signup" : "login";
  return <SignInForm mode={mode} next={params.next} />;
}
