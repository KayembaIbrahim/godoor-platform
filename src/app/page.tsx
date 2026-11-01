import dynamicImport from "next/dynamic";

export const dynamic = "force-static";
export const revalidate = 60;

/**
 * Customer Home page — the hub for the customer marketplace.
 *
 * This is now the default landing page for all users (logged in or not).
 * Users must be onboarded to see the marketplace; otherwise they see
 * a prompt to complete onboarding. The role guard inside CustomerHome
 * ensures business/rider/admin accounts are redirected to their respective
 * dashboards instead of the customer marketplace.
 */
export default function WelcomePage() {
  const CustomerHome = dynamicImport(() => import("./app/CustomerHome"), {
    ssr: true,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-go border-t-transparent" />
      </div>
    ),
  });

  return <CustomerHome />;
}
