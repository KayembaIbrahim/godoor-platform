import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata = {
  title: "Forgot your password | GoDoor",
  description: "Enter your email and we will send you a link to reset your GoDoor password.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-bg px-4 py-10">
      <ForgotPasswordForm />
    </div>
  );
}