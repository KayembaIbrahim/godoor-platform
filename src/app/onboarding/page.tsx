"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Package, ShoppingBag, Truck, ArrowRight, Store, Clock, MapPin, Play, Chrome, Twitter } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useSession, type Role } from "@/lib/session-store";
import { AppFooter } from "@/components/AppFooter";

const ROLES: {
  id: Role;
  label: string;
  desc: string;
  icon: typeof Package;
  href: string;
  color: string;
  iconBg: string;
  features: string[];
}[] = [
  {
    id: "customer",
    label: "Customer",
    desc: "Order food, groceries, pharmacy & packages across Uganda.",
    icon: ShoppingBag,
    href: "/onboarding/customer",
    color: "text-go",
    iconBg: "bg-go/15 ring-go/30",
    features: ["Browse local merchants", "Pay with MoMo or Airtel", "Live order tracking"],
  },
];

const APPLY_CARDS: {
  label: string;
  desc: string;
  icon: typeof Package;
  href: string;
  color: string;
  iconBg: string;
}[] = [
  {
    label: "Business",
    desc: "Apply to get your shop on GoDoor — we set up everything for you after approval.",
    icon: Package,
    href: "/partner?role=business",
    color: "text-primary-2",
    iconBg: "bg-primary/15 ring-primary/30",
  },
  {
    label: "Rider",
    desc: "Apply to deliver with GoDoor — approved riders are onboarded by our team.",
    icon: Truck,
    href: "/partner?role=rider",
    color: "text-primary",
    iconBg: "bg-primary/15 ring-primary/30",
  },
];

export default function OnboardingPage() {
  const { role, onboarded } = useSession();
  const router = useRouter();
  const setRole = useSession((s) => s.setRole);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [xLoading, setXLoading] = useState(false);
  const [error, setError] = useState("");

  // If already onboarded, send them to their app
  if (onboarded && role) {
    const dest = role === "customer" ? "/app" : role === "business" ? "/business" : "/rider";
    router.replace(dest);
    return null;
  }

  const pickRole = (r: (typeof ROLES)[number]) => {
    setRole(r.id);
    router.push(r.href);
  };

  const applyCard = (c: (typeof APPLY_CARDS)[number]) => {
    router.push(c.href);
  };

  const startGoogle = () => {
    setError("");
    setGoogleLoading(true);
    useSession.getState().signInWithGoogle().catch((e: any) => {
      setError(e?.message || "Google sign-in failed");
      setGoogleLoading(false);
    });
  };

  const startX = () => {
    setError("");
    setXLoading(true);
    useSession.getState().signInWithX().catch((e: any) => {
      setError(e?.message || "X sign-in failed");
      setXLoading(false);
    });
  };

  return (
    <>
    <div className="hero-wash min-h-[calc(100dvh-3.5rem)]">
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg flex-col px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Home">
            <ArrowLeft className="h-5 w-5 text-muted hover:text-fg transition" />
          </Link>
          <Logo size="sm" />
          <span className="w-5" />
        </div>

        <div className="mt-10 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-go to-go-2 shadow-lg shadow-go/20">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <rect x="3" y="2" width="13" height="20" rx="2" fill="#fff" />
              <path d="M16 2L21 4V20L16 22V2Z" fill="#0b0712" />
              <circle cx="14" cy="12.5" r="1.2" fill="var(--primary)" />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-semibold">Welcome to GoDoor</h1>
          <p className="mt-2 text-sm text-muted">Choose how you want to use GoDoor</p>
        </div>

        <div className="mt-8 flex-1 space-y-3">
          {ROLES.map((r, idx) => {
            const Icon = r.icon;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => pickRole(r)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-left transition-all hover:border-primary/40 hover:bg-elevated hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98] animate-fade-in"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ring-1 ${r.iconBg} transition-transform group-hover:scale-110`}>
                  <Icon className={`h-6 w-6 ${r.color}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold">{r.label}</p>
                  <p className="mt-0.5 text-sm text-muted">{r.desc}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.features.map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-[10px] font-medium text-dim">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-dim transition-transform group-hover:translate-x-1 group-hover:text-go" />
              </button>
            );
          })}

          {/* Business & rider join by application — no self-signup */}
          <div className="pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">For businesses & riders</p>
            <p className="mt-1 text-xs text-muted">We onboard partners personally — apply and our team sets up your account.</p>
          </div>
          {APPLY_CARDS.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => applyCard(r)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-dashed border-border bg-surface/70 p-4 text-left transition-all hover:border-primary/40 hover:bg-elevated hover:shadow-lg hover:shadow-primary/5 active:scale-[0.98]"
              >
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ring-1 ${r.iconBg} transition-transform group-hover:scale-110`}>
                  <Icon className={`h-5 w-5 ${r.color}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold">{r.label}</p>
                  <p className="mt-0.5 text-sm text-muted">{r.desc}</p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-dim transition-transform group-hover:translate-x-1 group-hover:text-go" />
              </button>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-dim">
          <Link href="/tutorial" className="min-h-11 inline-flex items-center gap-1.5 text-xs font-medium text-go hover:underline mb-2">
            <Play className="h-3 w-3" /> Watch how it works
          </Link>
            Already have an account?{" "}
            <Link href="/" className="font-medium text-go hover:underline">Sign in</Link>
          </p>
          <div className="mt-3 flex items-center justify-center gap-4 text-xs text-dim">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Takes &lt;1 minute</span>
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Uganda</span>
          </div>
        </div>

        {/* Social sign-in — Google & X (Twitter) */}
        <div className="mx-auto w-full max-w-lg px-4 pb-10">
          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              disabled={googleLoading}
              onClick={startGoogle}
              className="flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:hover:translate-y-0 rounded-xl border border-border bg-surface hover:bg-elevated"
            >
              {googleLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} fill="none" aria-label="Loading">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                  <path d="M12 2v2m0 18v2m-9-9l9 9m9-9l-9 9" stroke="currentColor" strokeWidth={2} fill="none" aria-hidden="true" />
                </svg>
              ) : (
                <>
                  <Chrome className="h-4 w-4 me-2" />
                  {"Google"}
                </>
              )}
            </button>
            <button
              type="button"
              disabled={xLoading}
              onClick={startX}
              className="flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:hover:translate-y-0 rounded-xl border border-border bg-surface hover:bg-elevated"
            >
              {xLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} fill="none" aria-label="Loading">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                  <path d="M12 2v2m0 18v2m-9-9l9 9m9-9l-9 9" stroke="currentColor" strokeWidth={2} fill="none" aria-hidden="true" />
                </svg>
              ) : (
                <>
                  <Twitter className="h-4 w-4 me-2" />
                  {"X"}
                </>
              )}
            </button>
          </div>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
      <AppFooter />
    </>
  );
}
