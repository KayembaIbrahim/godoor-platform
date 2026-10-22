import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

/**
 * The public page a user lands on from the reset link the admin sent them.
 *
 * The link carries the reset id as `?token=<id>`. The id is NOT a secret on
 * its own — it only says WHICH reset to redeem. The secret is the one-time
 * code, which the admin sends separately (a different channel), so a leaked
 * link is not enough to take the account over.
 *
 * `searchParams` is a request-time API, so reading it opts the route into
 * dynamic rendering — which is correct: the page is only meaningful for the
 * visitor holding that particular link.
 */
export const metadata = {
  title: "Set a new password | GoDoor",
  description: "Use your one-time reset code to choose a new GoDoor password.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
      <Suspense fallback={null}>
        <ResetPasswordForm token={token} />
      </Suspense>
    </div>
  );
}
