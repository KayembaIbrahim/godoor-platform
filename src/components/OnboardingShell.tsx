"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import type { ReactNode } from "react";

export function OnboardingShell({
  title,
  subtitle,
  step,
  total,
  children,
  backHref,
  onNext,
  nextLabel = "Continue",
  nextDisabled,
}: {
  title: string;
  subtitle?: string;
  step?: number;
  total?: number;
  children: ReactNode;
  backHref?: string;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="hero-wash min-h-[calc(100dvh-3.5rem)]">
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg flex-col px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href={backHref ?? "/"} aria-label="Back to home">
            <ArrowLeft className="h-5 w-5 text-muted" />
          </Link>
          <Logo size="sm" />
          <span className="w-5" />
        </div>

        {typeof step === "number" && typeof total === "number" && (
          <div className="mt-6 flex items-center gap-2">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                  i < step ? "bg-gradient-to-r from-go to-go-2 shadow-glow" : "bg-border"
                } ${i === step - 1 ? "animate-pulse" : ""}`}
              />
            ))}
          </div>
        )}

        <div className="mt-8">
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>

        <div className="mt-6 flex-1">{children}</div>

        {onNext && (
          <div className="sticky bottom-0 bg-bg/90 py-4 backdrop-blur">
            <button
              type="button"
              disabled={nextDisabled}
              onClick={onNext}
              className="sheen flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-go py-3.5 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100"
            >
              {nextLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-muted">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-dim">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2";
