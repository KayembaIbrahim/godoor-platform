"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg transition mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>
      <h1 className="font-display text-2xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-xs text-dim">Last updated: September 2026</p>
      <div className="mt-6 space-y-4 text-sm text-muted leading-relaxed">
        <section>
          <h2 className="font-semibold text-fg mb-2">1. Acceptance of Terms</h2>
          <p>By using GoDoor ("the Platform"), operated by ZentechX, you agree to these Terms of Service. If you do not agree, please do not use the Platform.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">2. Services</h2>
          <p>GoDoor connects customers with local merchants and riders for delivery of food, groceries, pharmacy items, and packages across Uganda. Payments are made via MTN MoMo, Airtel Money, or cash on delivery.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">3. User Accounts</h2>
          <p>You must provide accurate information when creating an account. You are responsible for maintaining the security of your account credentials. GoDoor reserves the right to suspend accounts that violate these terms.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">4. Payments</h2>
          <p>All payments are processed via mobile money (MTN MoMo or Airtel Money) or cash on delivery. GoDoor charges a service fee on completed deliveries. Fees are displayed before order confirmation.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">5. Disputes & Refunds</h2>
          <p>If you experience issues with an order, you may file a dispute through the Platform. GoDoor will review disputes within 24 hours. Refunds, when applicable, are processed to your GoDoor wallet or mobile money account within 48 hours.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">6. Liability</h2>
          <p>GoDoor acts as an intermediary between customers, merchants, and riders. We are not liable for the quality of products delivered, delays caused by third parties, or disputes between users.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">7. Changes to Terms</h2>
          <p>GoDoor may update these terms at any time. Continued use of the Platform constitutes acceptance of updated terms.</p>
        </section>
      </div>
      <div className="mt-8 pt-4 border-t border-border">
        <p className="text-xs text-dim">Questions? Contact us at <a href="mailto:support@godoor.site" className="text-go hover:underline">support@godoor.site</a></p>
      </div>
    </div>
  );
}
