"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowRight, ArrowLeft, ShoppingBag, Store, Truck, Search, ShoppingCart,
  CreditCard, MessageCircle, MapPin, Navigation, Package, Clock,
  CheckCircle, DollarSign, Star, Phone, Wallet, TrendingUp, Users,
  Smartphone, Globe, Shield, ChevronRight, Play, X, Bell
} from "lucide-react";
import { Logo } from "@/components/Logo";

/* ── Tutorial data ─────────────────────────────────────────────── */

type TutorialRole = "customer" | "business" | "rider";

type Slide = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  color: string;
  bg: string;
  tip?: string;
};

const TUTORIALS: Record<TutorialRole, { label: string; desc: string; icon: typeof Store; color: string; slides: Slide[] }> = {
  customer: {
    label: "Customer",
    desc: "Order food, groceries & more",
    icon: ShoppingBag,
    color: "text-go",
    slides: [
      { icon: Search, title: "Browse merchants", desc: "Open GoDoor and explore local restaurants, pharmacies, shops near you. Use GPS — merchants are sorted by distance.", color: "text-go", bg: "bg-go/10" },
      { icon: ShoppingCart, title: "Add to cart", desc: "Pick items from a merchant's menu. Adjust quantities and review your cart before checkout.", color: "text-go", bg: "bg-go/10" },
      { icon: CreditCard, title: "Pay via Mobile Money", desc: "Choose MTN MoMo, Airtel Money, or Cash. Send payment to the merchant's displayed number.", color: "text-primary", bg: "bg-primary/10", tip: "The merchant's MoMo number is shown at checkout." },
      { icon: MessageCircle, title: "Confirm in chat", desc: "After paying, send a screenshot or confirmation message in the order chat. The merchant verifies your payment.", color: "text-success", bg: "bg-success/10" },
      { icon: MapPin, title: "Track your delivery", desc: "Once a rider picks up your order, watch them move toward you on the live map — like Uber, but for everything.", color: "text-go", bg: "bg-go/10", tip: "The GoDoor marker shows the rider's exact position in real-time." },
      { icon: CheckCircle, title: "Receive & enjoy!", desc: "Your order arrives at your door. Rate your experience to help other customers.", color: "text-success", bg: "bg-success/10" },
    ],
  },
  business: {
    label: "Business",
    desc: "Sell on GoDoor & receive orders",
    icon: Store,
    color: "text-primary",
    slides: [
      { icon: Store, title: "Register your business", desc: "Sign up as a business. Add your name, category, location, MoMo number, and operating hours.", color: "text-primary", bg: "bg-primary/10" },
      { icon: Package, title: "Add your products", desc: "Open your dashboard → Products → Add items with names, descriptions, and prices in UGX.", color: "text-primary", bg: "bg-primary/10", tip: "Customers will see these products when they open your store." },
      { icon: Bell, title: "Receive orders", desc: "When a customer places an order, you'll see it in your dashboard with their details and items ordered.", color: "text-go", bg: "bg-go/10" },
      { icon: DollarSign, title: "Verify payment", desc: "Check your MoMo for the customer's payment. Open the order chat, view their screenshot, and confirm payment.", color: "text-success", bg: "bg-success/10", tip: "Never prepare an order before confirming payment." },
      { icon: Clock, title: "Prepare & hand off", desc: "Mark the order as 'Preparing' → 'Ready for pickup'. A nearby rider will claim the delivery.", color: "text-go", bg: "bg-go/10" },
      { icon: TrendingUp, title: "Track earnings", desc: "View your revenue, completed orders, and fee breakdown in the Earnings tab.", color: "text-success", bg: "bg-success/10" },
    ],
  },
  rider: {
    label: "Rider",
    desc: "Deliver orders & earn money",
    icon: Truck,
    color: "text-[#f97316]",
    slides: [
      { icon: Truck, title: "Register as a rider", desc: "Sign up with your vehicle type, plate number, and preferred service area. GPS auto-detects your location.", color: "text-[#f97316]", bg: "bg-[#f97316]/10" },
      { icon: Globe, title: "Go online", desc: "Open your rider dashboard. Toggle online status to start receiving delivery requests near you.", color: "text-[#f97316]", bg: "bg-[#f97316]/10" },
      { icon: Bell, title: "Accept deliveries", desc: "See available orders with distance, fare, and merchant name. Tap to accept one that fits you.", color: "text-go", bg: "bg-go/10", tip: "Orders are sorted by distance — closer = faster earnings." },
      { icon: MapPin, title: "Pickup the order", desc: "Navigate to the merchant using the in-app map. Confirm when you've collected the package.", color: "text-primary", bg: "bg-primary/10" },
      { icon: Navigation, title: "Deliver to customer", desc: "Your GPS broadcasts live to the customer and business. Navigate to the drop-off address.", color: "text-success", bg: "bg-success/10", tip: "Keep GoDoor open during delivery for accurate tracking." },
      { icon: DollarSign, title: "Get paid", desc: "Delivery fees are split: you keep 80%, platform keeps 20%. Track earnings in your dashboard.", color: "text-success", bg: "bg-success/10" },
    ],
  },
};

const ROLES: TutorialRole[] = ["customer", "business", "rider"];

/* ── Component ─────────────────────────────────────────────────── */

export default function TutorialPage() {
  const [selectedRole, setSelectedRole] = useState<TutorialRole | null>(null);
  const [slide, setSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => { setEntered(true); }, []);

  const tutorial = selectedRole ? TUTORIALS[selectedRole] : null;
  const slides = tutorial?.slides || [];
  const current = slides[slide];

  // Auto-play slides
  useEffect(() => {
    if (!autoPlay || !tutorial) return;
    const timer = setInterval(() => {
      setSlide((s) => {
        if (s >= slides.length - 1) { setAutoPlay(false); return s; }
        return s + 1;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [autoPlay, slide, slides.length, tutorial]);

  const goNext = useCallback(() => {
    if (slide < slides.length - 1) setSlide(s => s + 1);
  }, [slide, slides.length]);

  const goPrev = useCallback(() => {
    if (slide > 0) setSlide(s => s - 1);
  }, [slide]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") { setSelectedRole(null); setSlide(0); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goNext, goPrev]);

  /* ── Role picker ──────────────────────────────────────────── */
  if (!selectedRole) {
    return (
      <div className="hero-wash min-h-[calc(100dvh-3.5rem)]">
        <div className="mx-auto max-w-lg px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <Link href="/" className="text-muted hover:text-fg transition">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Logo size="sm" />
            <span className="w-5" />
          </div>

          <div className={`text-center transition-all duration-700 ${entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-go to-go-2 shadow-lg shadow-go/20">
              <Play className="h-7 w-7 text-white ml-0.5" />
            </div>
            <h1 className="font-display text-3xl font-bold">How to use GoDoor</h1>
            <p className="mt-2 text-sm text-muted">Pick your role to see a step-by-step guide</p>
          </div>

          <div className="mt-10 space-y-4">
            {ROLES.map((r, idx) => {
              const t = TUTORIALS[r];
              const Icon = t.icon;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setSelectedRole(r); setSlide(0); setAutoPlay(true); }}
                  className={`group flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-left transition-all hover:border-primary/40 hover:bg-elevated hover:shadow-lg active:scale-[0.98] ${entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
                  style={{ transitionDelay: `${200 + idx * 100}ms` }}
                >
                  <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ${t.slides[0].bg}`}>
                    <Icon className={`h-6 w-6 ${t.color}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-semibold">{t.label}</p>
                    <p className="text-sm text-muted">{t.desc}</p>
                    <div className="mt-2 flex items-center gap-1 text-xs font-medium text-go">
                      {t.slides.length} steps
                      <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-dim transition-transform group-hover:translate-x-1 group-hover:text-go" />
                </button>
              );
            })}
          </div>

          <div className="mt-10 text-center">
            <p className="text-xs text-dim">Use keyboard arrows to navigate slides</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Slide viewer ─────────────────────────────────────────── */
  const progress = ((slide + 1) / slides.length) * 100;
  const Icon = current.icon;
  const isLast = slide === slides.length - 1;
  const isFirst = slide === 0;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-bg flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button type="button" onClick={() => { setSelectedRole(null); setSlide(0); setAutoPlay(false); }}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-fg transition">
          <ArrowLeft className="h-4 w-4" /> Roles
        </button>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${tutorial!.color}`}>{tutorial!.label}</span>
          <span className="text-[10px] text-dim">{slide + 1}/{slides.length}</span>
        </div>
        <button type="button" onClick={() => setAutoPlay(!autoPlay)}
          className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition ${autoPlay ? "bg-go/15 text-go" : "bg-elevated text-muted hover:text-fg"}`}>
          {autoPlay ? "⏸ Pause" : "▶ Auto"}
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface">
        <div className="h-full bg-go transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div
          key={slide}
          className="w-full max-w-md text-center animate-fade-in"
        >
          {/* Step number */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-dim">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-go/15 text-[10px] font-bold text-go">{slide + 1}</span>
            Step {slide + 1} of {slides.length}
          </div>

          {/* Icon */}
          <div className={`mx-auto mb-6 grid h-20 w-20 place-items-center rounded-3xl ${current.bg} transition-all duration-300`}>
            <Icon className={`h-10 w-10 ${current.color}`} />
          </div>

          {/* Text */}
          <h2 className="font-display text-2xl font-bold">{current.title}</h2>
          <p className="mt-3 max-w-sm mx-auto text-sm text-muted leading-relaxed">{current.desc}</p>

          {/* Tip */}
          {current.tip && (
            <div className="mx-auto mt-5 max-w-sm rounded-xl bg-go/10 border border-go/20 px-4 py-3 text-left">
              <p className="text-[11px] font-semibold text-go flex items-center gap-1.5">
                <Shield className="h-3 w-3" /> Pro tip
              </p>
              <p className="mt-1 text-xs text-muted">{current.tip}</p>
            </div>
          )}
        </div>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 pb-4">
        {slides.map((_, i) => (
          <button key={i} type="button" onClick={() => setSlide(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === slide ? "w-6 bg-go" : i < slide ? "w-1.5 bg-go/40" : "w-1.5 bg-border"}`} />
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-6 pb-6 pt-2 safe-area-bottom">
        <button type="button" onClick={goPrev} disabled={isFirst}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:bg-elevated disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {isLast ? (
          <Link href="/"
            className="flex items-center gap-1.5 rounded-xl bg-go px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 active:scale-95">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <button type="button" onClick={goNext}
            className="flex items-center gap-1.5 rounded-xl bg-go px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 active:scale-95">
            Next <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
