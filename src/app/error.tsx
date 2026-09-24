"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GoDoor] page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 text-center shadow-2xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-danger/10 ring-1 ring-danger/20">
          <AlertTriangle className="h-8 w-8 text-danger" />
        </div>
        <div className="mt-5 flex justify-center"><Logo size="sm" /></div>
        <h1 className="mt-3 font-display text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          {error?.message || "An unexpected error occurred."}
        </p>
        {error?.stack && (
          <pre className="mt-2 max-h-24 overflow-auto rounded-xl bg-bg p-2 text-left text-[10px] text-dim text-left">
            {String(error.stack).split('\n').slice(0, 5).join('\n')}
          </pre>
        )}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
          <Link
            href="/"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-fg transition hover:bg-elevated"
          >
            <Home className="h-4 w-4" /> Go home
          </Link>
        </div>
        {error?.digest && (
          <p className="mt-4 text-[10px] text-dim">Error code: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
