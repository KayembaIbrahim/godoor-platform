"use client";

import { useState } from "react";
import Link from "next/link";
import { Headphones, MessageCircle, Mail, Phone, ChevronDown, ArrowLeft, Shield, FileText, AlertTriangle } from "lucide-react";
import { Logo } from "@/components/Logo";

const FAQ_ITEMS = [
  { q: "How do I pay for my order?", a: "Pay via MTN MoMo or Airtel Money directly to the merchant's mobile money number. After paying, confirm your payment in the app and your order will be processed. Cash on delivery is also available for some orders." },
  { q: "How long does delivery take?", a: "Most orders arrive within 30 minutes. Exact timing depends on your location and the merchant's preparation time. You can track your rider in real-time on the map." },
  { q: "Can I cancel my order?", a: "You can cancel an order before the merchant starts preparing it. Once preparation begins, cancellation may not be possible. Contact support for help." },
  { q: "What if my order is wrong or damaged?", a: "Contact the merchant directly via in-app chat or file a dispute from your order history. Our team reviews disputes within 24 hours and will resolve the issue." },
  { q: "How do I become a GoDoor merchant?", a: "Sign up as a business, complete verification with your trade licence and shop photos, and start receiving orders. GoDoor charges a small service fee per delivery." },
  { q: "How do I become a GoDoor rider?", a: "Register as a rider, upload your vehicle details and national ID, get verified by our team, and start accepting deliveries. You earn per delivery and keep your own schedule." },
  { q: "Is GoDoor available in my area?", a: "GoDoor is live across Uganda — Kampala, Masaka, Jinja, Mbale, Mbarara, Gulu, Fort Portal, and more. We're expanding every month." },
  { q: "How do I top up my GoDoor wallet?", a: "Go to your Wallet in the app and select 'Top up'. Enter the amount and you'll be redirected to MTN MoMo or Airtel Money to complete the payment." },
  { q: "What are the delivery fees?", a: "Delivery fees vary by distance. They start from UGX 2,000 for nearby deliveries. The exact fee is shown before you place your order." },
  { q: "How do I get a refund?", a: "If your order wasn't delivered or had issues, file a dispute or contact support. Refunds are processed to your GoDoor wallet or mobile money account within 48 hours." },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between -mx-2 rounded-xl px-2 py-4 text-left transition hover:bg-elevated">
        <span className="text-sm font-medium text-fg pr-4">{q}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="pb-4 text-sm text-muted leading-relaxed">{a}</p>}
    </div>
  );
}

export default function HelpPage() {
  const [search, setSearch] = useState("");
  const filtered = FAQ_ITEMS.filter((item) => item.q.toLowerCase().includes(search.toLowerCase()) || item.a.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24">
      <div className="mb-8">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg transition mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
        <h1 className="font-display text-2xl font-bold">Help Centre</h1>
        <p className="mt-1 text-sm text-muted">Find answers to common questions or get in touch with our team.</p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search questions..."
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none ring-go focus:ring-2"
        />
      </div>

      {/* FAQ */}
      <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
        <h2 className="text-sm font-semibold mb-2">Frequently asked questions</h2>
        {filtered.length === 0 ? (
          <p className="text-xs text-dim py-4 text-center">No matching questions found</p>
        ) : (
          filtered.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)
        )}
      </div>

      {/* Contact options */}
      <div className="grid gap-3 md:grid-cols-2">
        <a href="https://wa.me/256750685772?text=Hi%20GoDoor%2C%20I%20need%20help" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-elevated transition">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-success/10"><MessageCircle className="h-5 w-5 text-success" /></span>
          <div>
            <p className="text-sm font-semibold">WhatsApp Support</p>
            <p className="text-[10px] text-dim">Chat with us on WhatsApp</p>
          </div>
        </a>
        <a href="mailto:support@godoor.site"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 hover:bg-elevated transition">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-go/10"><Mail className="h-5 w-5 text-go" /></span>
          <div>
            <p className="text-sm font-semibold">Email Support</p>
            <p className="text-[10px] text-dim">support@godoor.site</p>
          </div>
        </a>
      </div>

      {/* Legal links */}
      <div className="mt-8 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold mb-3">Legal</h2>
        <div className="space-y-2">
          <Link href="/terms" className="flex items-center gap-2 text-xs text-muted hover:text-go transition">
            <FileText className="h-3.5 w-3.5" /> Terms of Service
          </Link>
          <Link href="/privacy" className="flex items-center gap-2 text-xs text-muted hover:text-go transition">
            <Shield className="h-3.5 w-3.5" /> Privacy Policy
          </Link>
          <Link href="/help" className="flex items-center gap-2 text-xs text-muted hover:text-go transition">
            <AlertTriangle className="h-3.5 w-3.5" /> Report a problem
          </Link>
        </div>
      </div>
    </div>
  );
}
