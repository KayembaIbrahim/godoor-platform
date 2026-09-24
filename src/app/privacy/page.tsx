"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg transition mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>
      <h1 className="font-display text-2xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-xs text-dim">Last updated: September 2026</p>
      <div className="mt-6 space-y-4 text-sm text-muted leading-relaxed">
        <section>
          <h2 className="font-semibold text-fg mb-2">1. Information We Collect</h2>
          <p>We collect your name, email, phone number, location data, and payment information when you use GoDoor. We also collect order history, device information, and usage data to improve the Platform.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">2. How We Use Your Information</h2>
          <p>Your information is used to process orders, connect you with merchants and riders, provide customer support, improve the Platform, and send service-related communications.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">3. Location Data</h2>
          <p>GoDoor uses your location to find nearby merchants, match you with riders, and enable live order tracking. You can disable location access, but this may limit some features.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">4. Data Sharing</h2>
          <p>We share your information only as necessary to fulfil orders: your name and delivery address with the merchant and rider. We do not sell your personal data to third parties.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">5. Data Security</h2>
          <p>We use industry-standard encryption and security measures to protect your data. Payment information is processed securely via MTN MoMo and Airtel Money — we do not store card details.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">6. Your Rights</h2>
          <p>You may request access to, correction of, or deletion of your personal data by contacting support@godoor.site. Account deletion will remove your data from active systems within 30 days.</p>
        </section>
        <section>
          <h2 className="font-semibold text-fg mb-2">7. Contact</h2>
          <p>For privacy-related questions, contact us at <a href="mailto:privacy@godoor.site" className="text-go hover:underline">privacy@godoor.site</a>.</p>
        </section>
      </div>
    </div>
  );
}
