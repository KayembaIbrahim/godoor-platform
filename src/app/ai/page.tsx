"use client";

import { useState } from "react";
import Link from "next/link";
import {
  HelpCircle, MessageCircle, ChevronDown, ChevronRight,
  ShoppingBag, Store, Truck, CreditCard, Package, MapPin,
  Shield, Clock, Phone, ArrowLeft, Search
} from "lucide-react";
import { Logo } from "@/components/Logo";

type FAQItem = { q: string; a: string };

type FAQSection = {
  id: string;
  title: string;
  icon: typeof ShoppingBag;
  color: string;
  items: FAQItem[];
};

const FAQ_SECTIONS: FAQSection[] = [
  {
    id: "ordering",
    title: "Ordering & Delivery",
    icon: ShoppingBag,
    color: "text-go",
    items: [
      { q: "How do I place an order on GoDoor?", a: "Browse merchants on the home page, tap on a store, add items to your cart, then go to checkout. Choose your payment method (MoMo, Airtel Money, or Cash), enter your delivery address, and tap \"Place Order\". The business will confirm and a rider will be assigned to deliver your order." },
      { q: "How do I track my order?", a: "Go to Orders in the navigation bar. Tap on any active order to see its status — pending, confirmed, out for delivery, or completed. You can also chat with the business and rider directly from the order page." },
      { q: "What if my order is late?", a: "Check the order status in your Orders page. If the order is stuck, you can message the business or rider in the chat. If there's a problem, you can raise a dispute from the order page and the GoDoor admin team will review it." },
      { q: "How do I cancel an order?", a: "You can cancel an order while it's still in \"pending\" status. Open the order, tap the cancel button, and confirm. Once a rider has been assigned, cancellation is no longer possible — please chat with the business instead." },
      { q: "Can I order from any merchant in Uganda?", a: "Yes! GoDoor works across all of Uganda. The app uses your GPS location to show nearby merchants first, but you can browse and order from any listed business." },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    icon: CreditCard,
    color: "text-primary",
    items: [
      { q: "How does payment work?", a: "GoDoor uses a P2P (peer-to-peer) payment model. When you place an order, you pay the business directly via their displayed MoMo or Airtel Money number. After sending money, send a confirmation screenshot in the chat. The business confirms payment and starts preparing your order." },
      { q: "What payment methods are accepted?", a: "You can pay via MTN Mobile Money (MoMo), Airtel Money, or Cash on delivery. Select your preferred method at checkout. Wallet payments will be available soon." },
      { q: "Is my payment secure?", a: "Your payment goes directly to the business's mobile money account — GoDoor never holds your money. Always confirm payment in the chat with a screenshot so there's a record for both you and the business." },
      { q: "What if I sent money but the business hasn't confirmed?", a: "Go to the order chat and send a screenshot of your payment confirmation. The business should confirm within minutes. If they don't respond, you can raise a dispute from the order page and our admin team will investigate." },
      { q: "What about delivery fees?", a: "Delivery fees are set by each business and shown at checkout. You pay the delivery fee separately to the rider in cash when they deliver, or via P2P mobile money." },
    ],
  },
  {
    id: "business",
    title: "For Businesses",
    icon: Store,
    color: "text-primary",
    items: [
      { q: "How do I register my business?", a: "Tap \"Sign In\" on the homepage, select \"Business\", create an account with your email, then complete the business onboarding — enter your business name, category, location, MoMo number, and upload your verification documents (shop photo, trade licence, national ID)." },
      { q: "How do I add products?", a: "After registering, go to your Business Dashboard → Products tab. Tap \"Add Product\" to add items with names, prices, descriptions, and images. Products appear immediately for customers to order." },
      { q: "How do I get paid?", a: "Customers pay you directly to your displayed MoMo or Airtel Money number. When an order comes in, check the chat for the payment confirmation screenshot. Once you confirm payment, prepare the order and assign a rider for delivery." },
      { q: "How do I confirm an order?", a: "When a customer places an order, you'll see it in your Orders tab. Open the order, check the chat for payment confirmation, then tap \"Confirm\" to accept the order. Assign a rider to deliver it." },
      { q: "How does verification work?", a: "To get verified, go to Store Settings and upload: (1) A photo of your shop/location, (2) Your trade licence from your city council, (3) Your national ID. Once approved by admin, you'll receive a verification badge that builds customer trust." },
      { q: "Can I post status updates?", a: "Yes! Go to the Status tab in your dashboard to post image or video updates (stories). These appear for your followers on the customer home page and auto-delete after 12 hours." },
    ],
  },
  {
    id: "riders",
    title: "For Riders",
    icon: Truck,
    color: "text-[#22c55e]",
    items: [
      { q: "How do I become a GoDoor rider?", a: "Sign up as a rider on the GoDoor app. Complete the onboarding by entering your vehicle details (type, plate number) and service area. Upload your vehicle photo and national ID for verification." },
      { q: "How do I accept deliveries?", a: "Go to your Rider Dashboard → Available tab. You'll see orders near you. Tap \"Accept\" on an order to take the delivery. Unverified riders can see orders but cannot accept them until verified." },
      { q: "How do I get paid as a rider?", a: "You collect delivery fees directly from customers in cash or via mobile money when you deliver. GoDoor does not charge riders any commission." },
      { q: "How does navigation work?", a: "When you accept an order, the tracking page shows the pickup location (business) and drop-off location (customer) on a live Mapbox map. Follow the turn-by-turn navigation to complete the delivery." },
      { q: "What vehicle types are accepted?", a: "GoDoor accepts motorbikes (boda-boda), bicycles, cars, and walking couriers. Select your vehicle type during registration." },
    ],
  },
  {
    id: "account",
    title: "Account & Profile",
    icon: Shield,
    color: "text-warning",
    items: [
      { q: "How do I create an account?", a: "Tap \"Sign In\" on the homepage, then select your role (Customer, Business, or Rider). Enter your email and password to create an account. You'll be guided through role-specific onboarding." },
      { q: "How do I switch between accounts?", a: "Go to your Profile (tap your avatar in the header), then Sign Out. Sign back in and select the account type you want to use." },
      { q: "How do I update my profile?", a: "Go to Profile from the navigation menu. You can update your name, photo, and settings. Businesses can manage their full store profile from the Store Settings page." },
      { q: "How do I enable location services?", a: "When you first visit GoDoor, your browser will ask for location permission. Allow it for accurate delivery tracking. You can also manually set your address from the map picker in your profile." },
    ],
  },
];

function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="divide-y divide-border">
      {items.map((item, i) => (
        <div key={i}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-elevated"
          >
            <MessageCircle className="h-4 w-4 shrink-0 text-muted" />
            <span className="flex-1 text-sm font-medium text-fg">{item.q}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open === i ? "rotate-180" : ""}`} />
          </button>
          {open === i && (
            <div className="px-4 pb-4 pt-1 pl-11">
              <p className="text-sm leading-relaxed text-muted">{item.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HelpDeskPage() {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const filteredSections = FAQ_SECTIONS.map((section) => {
    if (!search.trim()) return section;
    const q = search.toLowerCase();
    return {
      ...section,
      items: section.items.filter(
        (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
      ),
    };
  }).filter((section) => section.items.length > 0);

  return (
    <div className="hero-wash min-h-[70vh]">
      <div className="mx-auto max-w-lg px-4 pt-6 pb-20">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-go/15 ring-1 ring-go/20">
            <HelpCircle className="h-7 w-7 text-go" />
          </div>
          <h1 className="font-display text-2xl font-bold">Help Desk</h1>
          <p className="mt-1 text-sm text-muted">Find answers to common questions</p>
        </div>

        {/* Quick how-to order strip */}
        <div className="mb-6 grid grid-cols-4 gap-2 rounded-2xl border border-border bg-surface p-3">
          {[
            { icon: ShoppingBag, step: "1", label: "Browse" },
            { icon: Store, step: "2", label: "Pick store" },
            { icon: CreditCard, step: "3", label: "Pay MoMo" },
            { icon: Truck, step: "4", label: "Delivered" },
          ].map((s) => (
            <div key={s.step} className="flex flex-col items-center gap-1 text-center">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-go/10">
                <s.icon className="h-4 w-4 text-go" />
              </span>
              <p className="text-[9px] font-medium text-muted">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions..."
            className="w-full rounded-2xl border border-border bg-surface pl-10 pr-4 py-3 text-sm outline-none ring-go focus:ring-2 placeholder:text-dim"
          />
        </div>

        {/* FAQ Sections */}
        {filteredSections.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted">No results found. Try a different search.</p>
          </div>
        )}

        <div className="space-y-3">
          {filteredSections.map((section) => {
            const SectionIcon = section.icon;
            const isOpen = activeSection === section.id || search.trim().length > 0;

            return (
              <div key={section.id} className="rounded-2xl border border-border bg-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => setActiveSection(activeSection === section.id ? null : section.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-elevated"
                >
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-go/10`}>
                    <SectionIcon className={`h-5 w-5 ${section.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-fg">{section.title}</p>
                    <p className="text-[10px] text-dim">{section.items.length} questions</p>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
                {isOpen && <FAQAccordion items={section.items} />}
              </div>
            );
          })}
        </div>

        {/* Contact */}
        <div className="mt-8 rounded-2xl border border-go/20 bg-go/5 p-5 text-center">
          <Phone className="mx-auto h-6 w-6 text-go" />
          <h3 className="mt-2 font-display text-sm font-semibold">Still need help?</h3>
          <p className="mt-1 text-xs text-muted">Our support team replies fast — call, WhatsApp or email us.</p>
          <div className="mt-3 flex flex-col gap-2">
            <a
              href="mailto:support@godoor.ug"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-go px-4 py-2 text-xs font-semibold text-white hover:bg-go-2 transition"
            >
              <MessageCircle className="h-3.5 w-3.5" /> support@godoor.ug
            </a>
            <a
              href="tel:+256700000000"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-semibold text-fg hover:bg-elevated transition"
            >
              <Phone className="h-3.5 w-3.5" /> Call GoDoor Support
            </a>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Logo size="sm" className="justify-center" />
          <p className="mt-2 text-xs text-dim">A ZentechX company</p>
        </div>
      </div>
    </div>
  );
}
