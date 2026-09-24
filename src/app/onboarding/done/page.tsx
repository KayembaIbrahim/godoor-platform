"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-store";
import { Logo } from "@/components/Logo";
import { CheckCircle } from "lucide-react";

export default function OnboardingDonePage() {
  const { role, onboarded } = useSession();
  const [countdown, setCountdown] = useState(5);

  const dest = !role
    ? "/onboarding"
    : role === "customer"
      ? "/app"
      : role === "business"
        ? "/business"
        : "/rider";

  useEffect(() => {
    if (!onboarded || !role) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          window.location.href = dest;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [onboarded, role, dest]);

  if (!onboarded || !role) return null;

  const label = role === "customer" ? "Order now" : role === "business" ? "Go to dashboard" : "Start accepting orders";

  return (
    <div className="hero-wash flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-success/15">
          <CheckCircle className="h-10 w-10 text-success" />
        </div>
        <h1 className="font-display text-3xl font-semibold">You&apos;re all set!</h1>
        <p className="mt-3 text-muted">
          {role === "customer"
            ? "Your GoDoor account is ready. Browse merchants and order in Uganda."
            : role === "business"
              ? "Your business is registered. Customers in your area will see you on GoDoor."
              : "You're now a GoDoor rider. Accept deliveries and earn on your schedule."}
        </p>
        <div className="mt-8 space-y-3">
          <Link
            href={dest}
            className="inline-flex w-full items-center justify-center rounded-xl bg-go px-5 py-3 text-sm font-semibold text-white hover:bg-go-2"
          >
            {label}
          </Link>
          <p className="text-xs text-dim">Redirecting in {countdown}s…</p>
        </div>
        <div className="mt-10">
          <Logo size="lg" className="justify-center" />
        </div>
      </div>
    </div>
  );
}
