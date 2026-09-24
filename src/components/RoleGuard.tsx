"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, type Role } from "@/lib/session-store";
import { Loader2 } from "lucide-react";

/** Redirect users who aren't the given role (or not onboarded) to onboarding. */
export function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { onboarded, role: currentRole } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!onboarded || currentRole !== role) {
      router.replace("/onboarding");
    }
  }, [onboarded, currentRole, role, router]);

  if (!onboarded || currentRole !== role) {
    return (
      <div className="hero-wash grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-go" />
      </div>
    );
  }

  return <>{children}</>;
}
