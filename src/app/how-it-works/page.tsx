import Link from "next/link";
import {
  ShoppingBag, Bike, Store, Truck, Wallet, MapPin, MessageCircle,
  ShieldCheck, Star, ArrowRight, CheckCircle2,
} from "lucide-react";
import { MorseLogo } from "@/components/MorseLogo";

export const metadata = {
  title: "GoDoor — How it works",
  description: "Order food and shops, ride boda, sell as a business, or earn as a rider. Pay with Morse wallet, MoMo or cash.",
};

const CUSTOMER_STEPS = [
  { icon: ShoppingBag, title: "Browse & order", desc: "Find verified shops near you, add to cart in seconds — or book a Boda ride to go anywhere." },
  { icon: Wallet, title: "Pay your way", desc: "Morse wallet first, or MTN MoMo, Airtel Money, cash. Every order shows its 5% service fee up front." },
  { icon: MapPin, title: "Track live", desc: "Watch your rider — or your makeup artist — move on the map until they reach your door." },
];

const BUSINESS_STEPS = [
  { icon: Store, title: "Open your shop", desc: "Apply, get verified, list products. Orders land instantly with payment proof attached." },
  { icon: MessageCircle, title: "Confirm & prepare", desc: "Confirm MoMo or Morse payments in one tap, set prep time, mark ready for pickup." },
  { icon: Truck, title: "Hand to rider", desc: "Verified riders pick up and deliver. Traveling services can share live GPS with customers." },
];

const RIDER_STEPS = [
  { icon: Bike, title: "Go online", desc: "Flip to Deliveries for parcels or Boda mode for passengers. Requests near you appear live." },
  { icon: MapPin, title: "Navigate the route", desc: "Bold road route, turn-by-turn distance, GPS quality meter — built for boda navigation." },
  { icon: Star, title: "Get paid", desc: "Keep 80% of every delivery fee. Track daily and all-time earnings in your dashboard." },
];

function Steps({ steps, accent }: { steps: typeof CUSTOMER_STEPS; accent: string }) {
  return (
    <ol className="mt-4 grid gap-3 md:grid-cols-3">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.title} className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5">
            <span className="num absolute right-4 top-3 text-4xl font-bold text-border/60">{i + 1}</span>
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${accent}`}>
              <Icon className="h-5 w-5 text-white" />
            </span>
            <p className="mt-3 font-display text-base font-bold">{s.title}</p>
            <p className="mt-1 text-sm text-muted leading-relaxed">{s.desc}</p>
          </li>
        );
      })}
    </ol>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-24 pt-6 md:max-w-4xl">
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-go">GoDoor · Delivering Possibilities</p>
      <h1 className="mt-2 text-center font-display text-3xl font-bold md:text-4xl">How it works</h1>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted leading-relaxed">
        One platform, three roles. Order anything, ride anywhere, sell everything — tracked live on one pro map.
      </p>

      {/* Customers */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <ShoppingBag className="h-5 w-5 text-go" /> For customers
        </h2>
        <Steps steps={CUSTOMER_STEPS} accent="bg-go" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href="/app" className="flex items-center justify-center gap-2 rounded-2xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 transition">
            Order food & shops <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/ride" className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-2 transition">
            <Bike className="h-4 w-4" /> Book a boda
          </Link>
        </div>
      </section>

      {/* Payments — Morse first */}
      <section className="mt-8 rounded-3xl border border-go/30 bg-gradient-to-br from-go/10 via-surface to-surface p-5 md:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <MorseLogo markOnly className="h-5 w-5" /> Pay with Morse first
        </h2>
        <p className="mt-1 text-sm text-muted leading-relaxed">
          Morse wallet is our featured way to pay — send USD straight to the store&apos;s tag,
          then MTN MoMo, Airtel Money, or cash on delivery. Every total shows the 5% service fee before you confirm.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {[
            "Morse: instant USD to the business, receipt in chat",
            "MTN MoMo & Airtel Money: pay the number shown at checkout",
            "Cash: pay the rider at your door",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2 text-muted">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-go" /> {t}
            </li>
          ))}
        </ul>
      </section>

      {/* Business */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Store className="h-5 w-5 text-primary" /> For businesses
        </h2>
        <Steps steps={BUSINESS_STEPS} accent="bg-primary" />
        <Link href="/partner?role=business" className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:opacity-90 transition">
          Register your shop <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Riders */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Bike className="h-5 w-5 text-primary" /> For riders
        </h2>
        <Steps steps={RIDER_STEPS} accent="bg-primary" />
        <Link href="/partner?role=rider" className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-2 transition">
          Become a rider <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Safety */}
      <section className="mt-8 rounded-3xl border border-border bg-surface p-5 md:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <ShieldCheck className="h-5 w-5 text-success" /> Safe by design
        </h2>
        <p className="mt-1 text-sm text-muted leading-relaxed">
          Verified merchants and riders, live GPS on every trip, in-app chat, call buttons,
          ratings after delivery, and support from every order. Server-priced orders mean nobody can tamper with totals.
        </p>
      </section>
    </div>
  );
}
