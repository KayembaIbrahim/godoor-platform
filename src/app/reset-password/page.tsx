import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { SetNewPasswordForm } from "@/components/SetNewPasswordForm";

/**
 * The public page for password reset.
 *
 * Two distinct flows land here:
 *
 * 1. Admin-issued code: /reset-password?token=<codeId>
 *    → Shows the one-time code + new password form (ResetPasswordForm)
 *
 * 2. Self-service (Supabase recovery): user clicks email link → Supabase
 *    verifies recovery token → redirects to /reset-password with a valid
 *    session. No `token` param, but the user is already signed in.
 *    → Shows the "set new password" form (SetNewPasswordForm)
 *
 * This is a server component — it receives `token` from searchParams server-side
 * and delegates to client components for the actual UI. The client components
 * hydrate on the browser and handle auth state themselves.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token || "";

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <SetNewPasswordForm />
      )}
    </div>
  );
}
