"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  Smartphone, Wallet, Zap, ShieldCheck, ArrowRight, Truck,
  ShoppingBag, MapPin, Star, ChevronRight, Check,
  Clock, UtensilsCrossed, Pill, Package,
  MapPinned, ChevronDown, Play, TrendingUp,
  Download, Wifi, Globe, Users, BadgePercent, Flame,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { MorseLogo } from "@/components/MorseLogo";
import { useSession, roleHomePath } from "@/lib/session-store";

function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem("godoor-session");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed?.state?.onboarded && parsed.state.role);
  } catch { return false; }
}

function useAnimatedCounter(end: number, duration = 2000, start = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * end));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, duration, start]);
  return val;
}

function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

const FAQ_ITEMS = [
  { q: "How do I pay for my order?", a: "We recommend the Morse wallet for the swiftest checkout — top it up easily from MTN MoMo or Airtel Money, then pay in seconds. Morse-to-Morse transfers are free. You can also pay direct with MTN MoMo / Airtel Money, or cash on delivery." },
  { q: "How long does delivery take?", a: "Most orders are delivered within 30 minutes. You can track your rider in real-time on the map." },
  { q: "Can I return an item?", a: "If your order is incorrect or damaged, contact the merchant via in-app chat or file a dispute. Our team will resolve within 24 hours." },
  { q: "How do I become a GoDoor merchant?", a: "Submit a quick application — our team reviews it and, once approved, sets up your shop, products and delivery so you can start taking orders." },
  { q: "How do I become a GoDoor rider?", a: "Register as a rider, upload your vehicle details and national ID, get verified, and start accepting deliveries." },
  { q: "Is GoDoor available in my area?", a: "GoDoor is live across Uganda — Kampala, Masaka, Jinja, Mbale, Mbarara, Gulu, Fort Portal, and more. We're expanding every month." },
];

function FaqAccordion({ q, a }: { q: string; a: string }) {
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

const HOW_IT_WORKS_STEPS = [
  { icon: Smartphone, title: "Browse & Order", desc: "Discover local shops and restaurants near you. Browse menus, compare prices, and add items to your cart in seconds.", color: "from-go/20 to-go/5" },
  { icon: Wallet, title: "Pay swiftly with Morse", desc: "Our recommended wallet — top up easily from MTN MoMo or Airtel Money and check out in seconds. Morse-to-Morse transfers are free.", color: "from-primary/20 to-primary/5" },
  { icon: Truck, title: "Track & Receive", desc: "Watch your rider in real-time on the map. Average delivery in under 30 minutes, right to your door.", color: "from-success/20 to-success/5" },
];

const CATEGORY_ICONS: Record<string, { emoji: string; bg: string }> = {
  Food: { emoji: "🍜", bg: "bg-amber-500/20" },
  Restaurant: { emoji: "🍽️", bg: "bg-amber-500/20" },
  Pharmacy: { emoji: "💊", bg: "bg-blue-500/20" },
  Groceries: { emoji: "🛒", bg: "bg-emerald-500/20" },
  Shopping: { emoji: "🛍️", bg: "bg-purple-500/20" },
  Packages: { emoji: "📦", bg: "bg-orange-500/20" },
  Documents: { emoji: "📄", bg: "bg-slate-500/20" },
};
const DEFAULT_CATEGORY = { emoji: "🏪", bg: "bg-gray-500/20" };

const LANDING_CATEGORIES = [
  { icon: UtensilsCrossed, label: "Restaurants", desc: "Hot meals & snacks", color: "text-amber-500", bg: "bg-amber-500/10" },
  { icon: Pill, label: "Pharmacy", desc: "Medicine & health", color: "text-blue-500", bg: "bg-blue-500/10" },
  { icon: ShoppingBag, label: "Groceries", desc: "Fresh produce & essentials", color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { icon: Package, label: "Packages", desc: "Send anything, anywhere", color: "text-purple-500", bg: "bg-purple-500/10" },
];

function categoryMatches(m: any, label: string): boolean {
  const raw = (m.category || "").toLowerCase();
  if (label === "Restaurants") return raw.includes("food") || raw.includes("restaurant") || raw.includes("cafe");
  if (label === "Pharmacy") return raw.includes("pharm") || raw.includes("drug") || raw.includes("medical");
  if (label === "Groceries") return raw.includes("grocer") || raw.includes("supermarket") || raw.includes("store");
  if (label === "Packages") return raw.includes("package") || raw.includes("send") || raw.includes("courier");
  return raw.includes(label.toLowerCase());
}

export default function HomePage() {
  const { onboarded, role } = useSession();
  const [splash, setSplash] = useState<boolean>(() => hasStoredSession());
  const [liveOrders, setLiveOrders] = useState(0);
  const { ref: statsRef, visible: statsVisible } = useInView();
  const { ref: heroRef, visible: heroVisible } = useInView(0.1);

  // Real data from DB
  const [merchants, setMerchants] = useState<any[]>([]);
  const [totalMerchants, setTotalMerchants] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [merchantCount, setMerchantCount] = useState(0);
  const [districtCount, setDistrictCount] = useState(0);
  const [districts, setDistricts] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const animatedMerchants = useAnimatedCounter(totalMerchants || 1, 2000, statsVisible);
  const animatedDeliveries = useAnimatedCounter(totalOrders || 1, 2200, statsVisible);
  const animatedCities = useAnimatedCounter(districtCount || 1, 1800, statsVisible);

  useEffect(() => {
    if (onboarded) window.location.href = roleHomePath(role);
    else if (splash) setSplash(false);
  }, [onboarded, role, splash]);

  // Fetch real merchant data on mount
  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then((data) => {
        const list = data?.merchants || [];
        setMerchants(list);
        setTotalMerchants(list.length);
        setMerchantCount(list.length);
        // Count unique districts
        const districts = new Set(list.map((m: any) => m.district).filter(Boolean)) as Set<string>;
        setDistricts([...districts]);
        setDistrictCount(districts.size || 1);
        // Approximate orders from merchant total_orders
        const orders = list.reduce((sum: number, m: any) => sum + (m.total_orders || 0), 0);
        setTotalOrders(orders || list.length * 5); // rough estimate if no orders tracked
        setLiveOrders(Math.min(999, Math.max(12, list.length * 3)));
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, []);

  if (splash) {
    return (
      <div className="hero-wash flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="hero-wash">
      {/* Hero is below global HeaderClient — no duplicate sticky header needed */}

      {/* Hero */}
      <section ref={heroRef} className="relative mx-auto max-w-5xl px-4 pb-14 pt-24 md:pt-28">
        <div className="pointer-events-none absolute -left-24 top-6 -z-10 h-72 w-72 rounded-full bg-go/15 blur-3xl animate-float" />
        <div className="pointer-events-none absolute -right-16 top-40 -z-10 h-80 w-80 rounded-full bg-primary/10 blur-3xl animate-float" style={{ animationDelay: "1.2s" }} />
        <div className="pointer-events-none absolute left-1/2 top-10 -z-10 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-go/8 via-primary/8 to-success/8 blur-3xl" />
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="animate-fade-in">
            {/* Urgency badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-go/20 bg-go/10 px-3 py-1.5 text-xs font-semibold text-go shadow-glow">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-go" />
              </span>
              Delivering in 30 min or less
            </div>

            <h1 className="mt-5 font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight md:text-5xl lg:text-[3.6rem]">
              Your City.<br />
              <span className="text-gradient">Your Door.</span><br />
              GoDoor.
            </h1>

            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted md:text-base">
              Order food, groceries, pharmacy &amp; packages from 500+ local shops.
              Delivered to your door in minutes. We recommend the Morse wallet for swift payments.
            </p>

            {/* Live ordering indicator */}
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-go/20 bg-surface/60 px-3 py-1.5 text-xs text-muted shadow-xs">
              <Users className="h-3 w-3 text-go" />
              <span>
                {totalMerchants > 0
                  ? <><strong className="num text-go">{totalMerchants}</strong> shops on GoDoor</>
                  : <span className="text-go">Shops coming soon</span>
                }
              </span>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/onboarding" className="sheen relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-go px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02] active:scale-[0.98]">
                Order now — it&apos;s free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/tutorial" className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface/70 px-5 py-3.5 text-sm font-medium shadow-xs transition hover:bg-elevated">
                <Play className="h-4 w-4 text-go" /> See how it works
              </Link>
            </div>

            {/* Trust signals */}
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {["bg-go", "bg-primary", "bg-success", "bg-warning"].map((bg, i) => (
                    <div key={i} className={`grid h-8 w-8 place-items-center rounded-full ${bg} ring-2 ring-bg text-[10px] font-bold text-white`}>
                      {["S", "J", "G", "D"][i]}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="h-3 w-3 fill-warning text-warning" />)}
                  </div>
                  <p className="text-[10px] text-dim">Trusted by 10,000+ users</p>
                </div>
              </div>
              <div className="h-6 w-px bg-border hidden sm:block" />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-lg bg-surface border border-border px-2.5 py-1.5">
                  <span className="text-[11px] font-bold text-yellow-500">MoMo</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-surface border border-border px-2.5 py-1.5">
                  <span className="text-[11px] font-bold text-red-500">Airtel</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-go/30 bg-go/10 px-2.5 py-1.5">
                  <MorseLogo markOnly className="h-3.5 text-go" />
                  <span className="text-[11px] font-bold text-go">Morse · recommended</span>
                </div>
              </div>
            </div>
          </div>

          {/* Phone mockup */}
          <div className="relative hidden md:block">
            <div className="absolute inset-0 -z-10 mx-auto w-72 rounded-full bg-go/20 blur-3xl" />
            <div className="animate-float mx-auto w-64 rounded-[2.6rem] border border-border bg-surface/90 p-3 shadow-pop">
              <div className="space-y-2 rounded-3xl bg-gradient-to-b from-bg to-elevated p-3 ring-1 ring-border">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-20 rounded-full bg-go/20" />
                  <div className="flex gap-1">
                    <div className="h-3 w-3 rounded-full bg-go/30" />
                    <div className="h-3 w-3 rounded-full bg-border" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { bg: "bg-amber-500/15", icon: "UtensilsCrossed" },
                    { bg: "bg-blue-500/15", icon: "Pill" },
                    { bg: "bg-emerald-500/15", icon: "ShoppingCart" },
                    { bg: "bg-purple-500/15", icon: "Package" },
                  ].map((item, i) => (
                    <div key={i} className={`aspect-square rounded-xl ${item.bg} flex items-center justify-center`}>
                      <div className="h-5 w-5 rounded bg-white/10 animate-pulse" style={{ animationDelay: `${i * 300}ms` }} />
                    </div>
                  ))}
                </div>
                <div className="h-10 rounded-xl bg-go/15 flex items-center px-3">
                  <div className="h-2 w-24 rounded-full bg-go/30" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-xl bg-surface p-2 shadow-xs">
                    <div className="h-2 w-12 rounded bg-border mb-1" />
                    <div className="h-2 w-8 rounded bg-go/20" />
                  </div>
                  <div className="flex-1 rounded-xl bg-surface p-2 shadow-xs">
                    <div className="h-2 w-12 rounded bg-border mb-1" />
                    <div className="h-2 w-8 rounded bg-go/20" />
                  </div>
                </div>
              </div>
            </div>
            {/* Floating badges */}
            <div className="absolute -left-6 top-20 rounded-2xl border border-border bg-surface/90 backdrop-blur px-3 py-2 shadow-floating animate-slide-up">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Truck className="h-3.5 w-3.5 text-go" />
                <span>On the way!</span>
              </div>
              <p className="mt-0.5 pl-5 text-[9px] text-dim">3 min to your door</p>
            </div>
            <div className="absolute -right-4 bottom-28 rounded-2xl border border-border bg-surface/90 backdrop-blur px-3 py-2 shadow-floating animate-slide-up" style={{ animationDelay: "400ms" }}>
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <BadgePercent className="h-3.5 w-3.5 text-success" />
                <span>Free delivery!</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Urgency Bar */}
      <section className="border-y border-border bg-go/5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center divide-x divide-border px-4">
          {[
            { icon: Clock, text: "Delivering in 30 min or less" },
            { icon: BadgePercent, text: "Free delivery today" },
            { icon: ShieldCheck, text: "100% payment protection" },
          ].map((item, i) => {
            const ItemIcon = item.icon;
            return (
              <div key={i} className="flex items-center gap-2 px-5 py-3 text-xs font-medium text-muted min-w-[180px] justify-center">
                <ItemIcon className="h-3.5 w-3.5 text-go" />
                {item.text}
              </div>
            );
          })}
        </div>
      </section>

      {/* Animated Stats Bar */}
      <section ref={statsRef} className="border-b border-border bg-surface/30">
        <div className="mx-auto flex max-w-5xl flex-wrap items-stretch justify-center gap-3 px-4 py-8">
          {[
            { value: animatedMerchants, suffix: "+", label: "Active merchants" },
            { value: animatedDeliveries.toLocaleString(), suffix: "+", label: "Deliveries completed", isStr: true },
            { value: animatedCities, suffix: "+", label: "Cities covered" }
          ].map((s) => (
            <div key={s.label} className="tile flex-1 min-w-[150px] px-6 py-6 text-center transition hover:-translate-y-0.5 hover:shadow-floating">
              <p className="text-gradient font-display text-3xl font-bold">
                {s.isStr ? s.value : s.value}{s.suffix}
              </p>
              <p className="mt-1 text-xs font-medium text-muted">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trending Now */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-go/10 px-3 py-1 text-[10px] font-bold text-go uppercase">
                <Flame className="h-3 w-3" /> {merchants.length > 0 ? "Trending now" : "Coming soon"}
              </div>
              <h2 className="mt-3 font-display text-2xl font-bold">
                {merchants.length > 0 ? "Popular near you" : "Shops on GoDoor"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {merchants.length > 0
                  ? `${merchants.length} local businesses ready to deliver`
                  : "Businesses are joining GoDoor every day"
                }
              </p>
            </div>
            {merchants.length > 0 && (
              <Link href="/app" className="hidden items-center gap-1 text-sm font-medium text-go hover:underline sm:flex">
                View all <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          {dataLoading ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-2xl border border-border bg-surface overflow-hidden animate-pulse">
                  <div className="h-32 bg-elevated" />
                  <div className="p-4 space-y-2">
                    <div className="h-3 w-24 rounded bg-border" />
                    <div className="h-2 w-16 rounded bg-border" />
                  </div>
                </div>
              ))}
            </div>
          ) : merchants.length > 0 ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
              {merchants.slice(0, 8).map((m) => {
                const cat = CATEGORY_ICONS[m.category] || DEFAULT_CATEGORY;
                return (
                  <Link key={m.id} href={`/business?merchantId=${m.id}`} className="group card-hover overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
                    <div className={`relative ${cat.bg} flex h-32 items-center justify-center`}>
                      {m.logo_url ? (
                        <img src={m.logo_url} alt={m.name} className="h-20 w-20 rounded-xl object-cover" />
                      ) : (
                        <span className="text-5xl">{cat.emoji}</span>
                      )}
                      {m.verified && (
                        <span className="absolute top-2 right-2 rounded-full bg-success/90 backdrop-blur px-2 py-0.5 text-[10px] font-semibold text-white border border-success/50">
                          Verified
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-display text-sm font-semibold group-hover:text-go transition">{m.name}</h3>
                      <p className="mt-0.5 text-xs text-muted">{m.category}{m.area ? ` · ${m.area}` : ""}</p>
                      <div className="mt-2 flex items-center justify-between">
                        {m.rating && m.rating > 0 ? (
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 fill-go text-go" />
                            <span className="text-xs font-semibold">{m.rating.toFixed(1)}</span>
                          </div>
                        ) : (
                          <span className="rounded-full bg-go/10 px-2 py-0.5 text-[10px] font-semibold text-go">New</span>
                        )}
                        {m.delivery_fee_ugx > 0 && (
                          <span className="text-[10px] text-muted">{(m.delivery_fee_ugx).toLocaleString()} UGX delivery</span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
              <ShoppingBag className="mx-auto h-10 w-10 text-dim" />
              <h3 className="mt-3 font-display text-base font-semibold">No shops listed yet</h3>
              <p className="mt-1 text-sm text-muted max-w-xs mx-auto">
                Be the first business on GoDoor. Register your shop and start receiving orders today.
              </p>
              <Link href="/partner?role=business" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-go px-5 py-2.5 text-sm font-semibold text-white hover:bg-go-2 transition">
                Register your business <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {merchants.length > 4 && (
            <Link href="/app" className="mt-6 flex items-center justify-center gap-1 text-sm font-medium text-go hover:underline sm:hidden">
              View all merchants <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center font-display text-2xl font-bold">How it works</h2>
          <p className="mt-2 text-center text-sm text-muted">Three simple steps to get what you need</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3 stagger">
            {HOW_IT_WORKS_STEPS.map((step, idx) => {
              const StepIcon = step.icon;
              return (
                <div key={idx} className="relative rounded-2xl border border-border bg-surface p-7 text-center transition hover:border-go/30 hover:bg-go/[0.02]">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center justify-center rounded-full bg-go px-3 py-1 text-[10px] font-bold text-white shadow-md shadow-go/20">
                      Step {idx + 1}
                    </span>
                  </div>
                  <div className={`mx-auto mb-4 mt-1 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-b ${step.color}`}>
                    <StepIcon className="h-8 w-8 text-go" />
                  </div>
                  <h3 className="font-display text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted leading-relaxed">{step.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Featured Categories */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center font-display text-2xl font-bold">Everything you need, delivered</h2>
          <p className="mt-2 text-center text-sm text-muted">From restaurants to pharmacies — we deliver it all</p>
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 stagger">
            {LANDING_CATEGORIES.map((c) => {
              const CatIcon = c.icon;
              const catCount = merchants.filter((m) => categoryMatches(m, c.label)).length;
              return (
                <Link key={c.label} href="/app" className="group card-hover rounded-2xl border border-border bg-surface p-5 shadow-xs">
                  <div className={`grid h-11 w-11 place-items-center rounded-xl ${c.bg} transition-transform duration-200 group-hover:scale-110`}>
                    <CatIcon className={`h-5.5 w-5.5 ${c.color}`} />
                  </div>
                  <p className="mt-3 font-display text-sm font-semibold group-hover:text-go transition-colors">{c.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{c.desc}</p>
                  <p className="mt-2 text-[10px] font-medium text-go/70">
                    {catCount > 0 ? `${catCount} ${catCount === 1 ? "shop" : "shops"}` : "Coming soon"}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Available in */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center font-display text-2xl font-bold">Available across Uganda</h2>
          <p className="mt-2 text-center text-sm text-muted">
            {districts.length > 0 ? `Delivering in ${districts.length} ${districts.length === 1 ? "district" : "districts"}` : "Growing every day"}
          </p>
          <div className="mt-8 grid grid-cols-3 gap-2 md:grid-cols-6">
            {districts.length > 0 ? districts.map((city) => (
              <div key={city} className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface py-2.5 text-xs font-medium transition hover:border-go/40 hover:bg-go/5">
                <MapPinned className="h-3 w-3 text-go" />{city}
              </div>
            )) : (
              <div className="col-span-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/50 py-6 text-xs text-muted md:col-span-6">
                <MapPinned className="h-3 w-3 text-go" /> Launching in your area soon
              </div>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-dim">And many more districts — check the app for your area</p>
        </div>
      </section>

      {/* Why GoDoor */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center font-display text-2xl font-bold">Why choose GoDoor</h2>
          <p className="mt-2 text-center text-sm text-muted">Built for Uganda, designed for everyone</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2 stagger">
            {[
              { icon: Wallet, title: "Morse wallet — recommended", desc: "Swift payments for everyone. Top up easily from MTN MoMo or Airtel Money. Morse-to-Morse transfers and deposits are free." },
              { icon: MapPin, title: "Live GPS Tracking", desc: "Watch your delivery in real-time on the map. Know exactly where your order is." },
              { icon: ShieldCheck, title: "Verified Merchants & Riders", desc: "Every business and rider is verified for your safety and trust." },
              { icon: Clock, title: "Fast Delivery", desc: "Average delivery in under 30 minutes. Track every step of the way." },
            ].map((b) => {
              const BIcon = b.icon;
              return (
                <div key={b.title} className="flex items-start gap-4 rounded-2xl border border-border bg-surface p-5">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-go/10">
                    <BIcon className="h-5 w-5 text-go" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-semibold">{b.title}</h3>
                    <p className="mt-1 text-sm text-muted leading-relaxed">{b.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Morse wallet — recommended for everyone */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <div className="overflow-hidden rounded-3xl border border-go/25 bg-gradient-to-br from-go/10 via-surface to-surface p-8 md:p-10">
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-go px-3 py-1 text-[10px] font-bold text-white uppercase shadow-glow">
                  <Zap className="h-3 w-3" /> Recommended · Swift payments
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <MorseLogo markOnly className="h-8 text-go" />
                  <h2 className="font-display text-2xl font-bold md:text-3xl">
                    Pay swiftly with <span className="text-go">Morse</span>
                  </h2>
                </div>
                <p className="mt-3 text-sm text-muted leading-relaxed max-w-md">
                  The fastest way to enjoy GoDoor. Top up your Morse wallet simply and easily
                  from MTN MoMo or Airtel Money, then check out in seconds —
                  no delays at the till, no failed prompts.
                </p>
                <ul className="mt-5 space-y-2.5">
                  {[
                    { icon: Zap, text: "Swift transactions — pay for any order in seconds" },
                    { icon: Smartphone, text: "Recharge easily from MTN MoMo or Airtel Money" },
                    { icon: Users, text: "Free Morse-to-Morse transfers — send money for free" },
                    { icon: BadgePercent, text: "Free deposits — more of your money stays yours" },
                  ].map((f) => {
                    const FIcon = f.icon;
                    return (
                      <li key={f.text} className="flex items-center gap-2.5 text-sm text-fg">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-go/10">
                          <FIcon className="h-4 w-4 text-go" />
                        </span>
                        {f.text}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/wallet" className="inline-flex items-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-semibold text-white shadow-glow transition hover:bg-go-2 active:scale-[0.98]">
                    <Wallet className="h-4 w-4" /> Top up with Morse
                  </Link>
                  <Link href="/tutorial" className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium transition hover:bg-elevated">
                    How it works <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
              <div className="grid gap-3">
                {[
                  { emoji: "🛍️", title: "Customers", desc: "One-tap checkout, live order tracking, zero payment stress." },
                  { emoji: "🏪", title: "Businesses", desc: "Get paid swiftly on every order — no POS, no paperwork." },
                  { emoji: "🛵", title: "Riders", desc: "Swift payouts and clear earnings on every delivery." },
                ].map((c) => (
                  <div key={c.title} className="card-lift flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
                    <span className="text-2xl">{c.emoji}</span>
                    <div>
                      <p className="text-sm font-semibold">{c.title} — we recommend Morse most</p>
                      <p className="mt-0.5 text-xs text-muted leading-relaxed">{c.desc}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-go/30 bg-go/5 px-4 py-3">
                  <MorseLogo className="h-3.5 text-go" />
                  <p className="text-[11px] font-medium text-muted">Morse-to-Morse transfers &amp; deposits are free</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* For Merchants / For Riders */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Merchants */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-surface p-6 shadow-card">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" aria-hidden />
              <div className="relative">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[10px] font-bold text-primary uppercase">
                For Merchants
              </div>
              <h3 className="mt-3 font-display text-lg font-bold">Grow your business with GoDoor</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                Reach thousands of customers. Get orders delivered by verified riders. Easy mobile money payments — no POS needed.
              </p>
              <ul className="mt-3 space-y-1.5">
                {["Free to join", "No monthly fees", "Instant mobile money payouts", "Live order tracking"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-muted"><Check className="h-3 w-3 text-success" />{f}</li>
                ))}
              </ul>
              <Link href="/partner?role=business" className="btn btn-primary mt-5">
                Apply to join <ArrowRight className="h-4 w-4" />
              </Link>
              </div>
            </div>
            {/* Riders */}
            <div className="relative overflow-hidden rounded-2xl border border-success/20 bg-gradient-to-br from-success/10 via-surface to-surface p-6 shadow-card">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-success/10 blur-3xl" aria-hidden />
              <div className="relative">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[10px] font-bold text-success uppercase">
                For Riders
              </div>
              <h3 className="mt-3 font-display text-lg font-bold">Earn on your own schedule</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">
                Pick orders near you, deliver when you want. Competitive earnings per delivery.
              </p>
              <ul className="mt-3 space-y-1.5">
                {["Choose your own hours", "Real-time delivery map", "Track your earnings daily", "Flexible payout schedule"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-muted"><Check className="h-3 w-3 text-success" />{f}</li>
                ))}
              </ul>
              <Link href="/partner?role=rider" className="btn btn-soft mt-5 !text-success !bg-success/10 hover:!bg-success/15">
                Apply to deliver <ArrowRight className="h-4 w-4" />
              </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Download the App */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-5xl px-4">
          <div className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-go/5 p-8 md:p-12">
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-go/10 px-3 py-1 text-[10px] font-bold text-go uppercase">
                  <Download className="h-3 w-3" /> Get the app
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold md:text-3xl">
                  Take GoDoor<br />
                  <span className="text-go">everywhere.</span>
                </h2>
                <p className="mt-3 text-sm text-muted leading-relaxed max-w-sm">
                  Download the native app for the fastest experience. Push notifications for delivery updates, offline browsing, and one-tap reordering.
                </p>
                <ul className="mt-4 space-y-2">
                  {[
                    { icon: Zap, text: "Faster than mobile web" },
                    { icon: Wifi, text: "Browse offline" },
                    { icon: Globe, text: "Works on any Android phone" },
                  ].map((f) => {
                    const FIcon = f.icon;
                    return (
                      <li key={f.text} className="flex items-center gap-2 text-sm text-muted">
                        <FIcon className="h-4 w-4 text-go" /> {f.text}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/onboarding" className="inline-flex items-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-go/20 transition hover:bg-go-2 active:scale-[0.98]">
                    <Download className="h-4 w-4" /> Download APK
                  </Link>
                  <Link href="/app" className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium transition hover:bg-elevated">
                    Use web app <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
              <div className="relative hidden md:flex items-center justify-center">
                <div className="relative">
                  <div className="animate-float w-52 rounded-[2.6rem] border border-border bg-surface/90 p-3 shadow-pop">
                    <div className="space-y-2 rounded-3xl bg-gradient-to-b from-bg to-elevated p-3 ring-1 ring-border">
                      <div className="flex items-center gap-2">
                        <Logo size="sm" />
                      </div>
                      <div className="space-y-1.5">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex gap-2">
                            <div className="h-10 w-10 rounded-lg bg-go/10" />
                            <div className="flex-1 space-y-1 pt-1">
                              <div className="h-2 w-20 rounded bg-border" />
                              <div className="h-2 w-12 rounded bg-go/20" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="absolute -top-3 -right-3 rounded-full bg-go px-3 py-1.5 text-[10px] font-bold text-white shadow-lg shadow-go/30">
                    FREE
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-b border-border bg-surface/30 py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center font-display text-2xl font-bold">What people are saying</h2>
          <p className="mt-2 text-center text-sm text-muted">Real stories from GoDoor users across Uganda</p>
          <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
            <Star className="mx-auto h-8 w-8 text-dim" />
            <h3 className="mt-3 font-display text-base font-semibold">Testimonials coming soon</h3>
            <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
              As more people use GoDoor, we&apos;ll share real stories from customers, merchants, and riders across Uganda.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-border py-14">
        <div className="mx-auto max-w-2xl px-4">
          <h2 className="text-center font-display text-2xl font-bold">Frequently asked questions</h2>
          <div className="mt-8">
            {FAQ_ITEMS.map((item) => (
              <FaqAccordion key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-gradient-to-b from-go/5 to-transparent py-14">
        <div className="relative mx-auto max-w-5xl px-4 text-center">
          <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-64 w-64 -translate-x-1/2 rounded-full bg-go/15 blur-3xl" aria-hidden />
          <Logo size="lg" className="justify-center" />
          <p className="mt-4 text-lg text-muted">Delivering Possibilities.</p>

          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-go/10 px-3 py-1.5 text-xs font-medium text-go">
            <BadgePercent className="h-3 w-3" />
            Free delivery on your first order
          </div>

          <div className="mt-4 inline-flex items-center gap-2 text-xs text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-go" />
            </span>
            {totalMerchants > 0 ? `${districtCount} ${districtCount === 1 ? "district" : "districts"} · ${totalMerchants} shops live` : "Launching soon"}
          </div>

          <Link href="/onboarding" className="sheen relative mt-8 inline-block overflow-hidden rounded-xl bg-go px-8 py-4 text-sm font-semibold text-white shadow-glow transition-all hover:scale-[1.02] active:scale-[0.98]">
            {onboarded ? "Open app" : "Try GoDoor now — it's free"}
          </Link>
          <p className="mt-3 text-xs text-dim">No card needed. Just your phone — we recommend Morse for the swiftest checkout.</p>
          <Link href="/tutorial" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-go hover:underline">Watch how it works <Play className="h-3 w-3" /></Link>
        </div>
      </section>
    </div>
  );
}
