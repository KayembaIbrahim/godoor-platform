"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { Price } from "@/components/Price";
import { Suspense } from "react";

function SuccessBody() {
  const params = useSearchParams();
  const total = Number(params.get("total") || 0);

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
      <h1 className="mt-4 font-display text-2xl font-semibold">Order paid</h1>
      <p className="mt-2 text-muted">
        {total > 0 ? (
          <><Price amount={total} /> debited from your GoDoor wallet.</>
        ) : (
          <>Payment confirmed from your GoDoor wallet.</>
        )}
      </p>
      <p className="mt-2 text-sm text-dim">
        Merchant will confirm next. Your rider will be assigned when the order is ready.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Link href="/app" className="rounded-xl bg-go py-3 text-sm font-semibold text-white">
          Order again
        </Link>
        <Link href="/wallet" className="text-sm text-muted hover:text-fg">
          View wallet
        </Link>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted">Loading…</div>}>
      <SuccessBody />
    </Suspense>
  );
}
