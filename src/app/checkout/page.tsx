"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, Phone, Copy, Check, MessageCircle,
  MapPin, Clock, Smartphone, Banknote,
  CalendarDays, PartyPopper, Truck,
} from "lucide-react";
import { formatUgx, calcServiceFee, calcDeliveryFee, BULKY_ITEM_SURCHARGE_UGX } from "@/lib/utils";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session-store";
import { useGeolocation, distanceKm } from "@/lib/location";
import { createOrder, fetchMerchantById, type DBMerchant } from "@/lib/db";
import { usePromo } from "@/lib/customer-stores";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { AddressSearchModal, getLastAddress } from "@/components/AddressSearchModal";
import { MorseLogo } from "@/components/MorseLogo";

/* ─── Confetti particle ─── */
function ConfettiParticle({ index }: { index: number }) {
  const colors = ["bg-go", "bg-success", "bg-primary", "bg-warning", "bg-go-2"];
  const left = 10 + Math.random() * 80;
  const delay = Math.random() * 0.6;
  const duration = 1.2 + Math.random() * 1.0;
  const size = 6 + Math.random() * 6;
  const rotation = Math.random() * 360;
  const color = colors[index % colors.length];

  return (
    <div
      className={`absolute ${color} rounded-sm opacity-0`}
      style={{
        left: `${left}%`,
        top: "-8px",
        width: `${size}px`,
        height: `${size}px`,
        transform: `rotate(${rotation}deg)`,
        animation: `confetti-fall ${duration}s ${delay}s ease-out forwards`,
      }}
    />
  );
}

/* ─── Delivery time estimate ─── */
function deliveryEstimate(distKm: number): string {
  const avgSpeed = 25; // km/h average in Kampala traffic
  const minMin = Math.max(15, Math.round((distKm / avgSpeed) * 60 * 0.7));
  const maxMin = Math.max(minMin + 5, Math.round((distKm / avgSpeed) * 60 * 1.3));
  return `${minMin}–${maxMin} min`;
}

/* ─── Map preview via OpenStreetMap tile ─── */
function MapPreview({ lat, lng }: { lat: number; lng: number }) {
  const zoom = 15;
  const scale = 1;
  const w = 400;
  const h = 120;
  // Use a static map tile approximation (OSM doesn't have a static API, use a mapbox-like placeholder)
  return (
    <div className="relative mt-2 h-[120px] w-full overflow-hidden rounded-xl border border-border bg-surface">
      <iframe
        title="Delivery location map"
        width="100%"
        height="120"
        style={{ border: 0, pointerEvents: "none" }}
        loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.015},${lat - 0.008},${lng + 0.015},${lat + 0.008}&layer=mapnik&marker=${lat},${lng}`}
      />
      <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-go/20 rounded-xl" />
    </div>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const lines = useCart((s) => s.lines);
  const merchantId = useCart((s) => s.merchantId);
  const clear = useCart((s) => s.clear);
  const { onboarded, role, profile, supabaseUser } = useSession();
  const signup = useSignupPrompt();
  const { coords, address: gpsAddress, status: locStatus, accuracy, refresh } = useGeolocation();

  // Business/rider have no checkout — redirect to their dashboard and clear any stray cart
  useEffect(() => {
    if (!onboarded) return;
    if (role === "business") { useCart.getState().clear(); window.location.href = "/business"; }
    else if (role === "rider") { useCart.getState().clear(); window.location.href = "/rider"; }
    else if (role === "admin") window.location.href = "/admin";
  }, [role, onboarded]);

  const [dbMerchant, setDbMerchant] = useState<DBMerchant | null>(null);
  const [morseCfg, setMorseCfg] = useState<{ rateUgx: number } | null>(null);
  const [address, setAddress] = useState(gpsAddress || "");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"momo" | "airtel" | "cash" | "morse">("momo");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [orderCreated, setOrderCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [addrSearchOpen, setAddrSearchOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("asap");

  const [savedAddr, setSavedAddr] = useState<{ place: string; lat: number; lng: number } | null>(null);
  useEffect(() => {
    const saved = getLastAddress();
    if (saved) {
      setSavedAddr(saved);
      setAddress(saved.place);
    }
  }, []);
  const { appliedPromo, apply: applyPromo, clear: clearPromo } = usePromo();

  useEffect(() => {
    if (merchantId) fetchMerchantById(merchantId).then((m) => setDbMerchant(m || null));
  }, [merchantId]);

  useEffect(() => {
    fetch("/api/morse").then((r) => r.json()).then((j) => { if (j.config) setMorseCfg(j.config); }).catch(() => {});
  }, []);

  // Keep the selection valid when the business doesn't accept the current method.
  // (Declared here, above the early returns below — rules of hooks.)
  // Morse is the preferred method: auto-select it once the store's tag loads,
  // unless the customer already picked something else.
  const methodTouched = useRef(false);
  useEffect(() => {
    if (!dbMerchant || methodTouched.current || paymentMethod === "morse") return;
    const accepts = !dbMerchant.accepted_payments?.length || dbMerchant.accepted_payments.includes("morse");
    if (accepts && dbMerchant.morse_tag) {
      setPaymentMethod("morse");
    }
  }, [dbMerchant, paymentMethod]);
  useEffect(() => {
    if (!dbMerchant || paymentMethod === "morse") return;
    const ok = !dbMerchant.accepted_payments?.length ? true : dbMerchant.accepted_payments.includes(paymentMethod);
    if (!ok) {
      const pool: Array<"morse" | "cash" | "momo" | "airtel"> = dbMerchant.morse_tag
        ? ["morse", "cash", "momo", "airtel"]
        : ["cash", "momo", "airtel"];
      const fallback = pool.find((p) => !dbMerchant.accepted_payments?.length || dbMerchant.accepted_payments!.includes(p)) || "cash";
      setPaymentMethod(fallback);
    }
  }, [dbMerchant, paymentMethod]);

  const deliveryAddress = savedAddr?.place || gpsAddress || address;
  const merchantMomo = dbMerchant?.momo_number || "";
  const merchantMomoName = dbMerchant?.momo_name || dbMerchant?.name || "Merchant";
  const merchantName = dbMerchant?.name || profile.businessName || "";

  const customerLoc = useMemo(() => savedAddr?.lat && savedAddr?.lng ? { lat: savedAddr.lat, lng: savedAddr.lng }
      : coords?.lat && coords?.lng ? { lat: coords.lat, lng: coords.lng }
      : { lat: 0.3533, lng: 32.5822 } as const, [savedAddr, coords]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + l.unitPriceUgx * l.quantity, 0);
    const merchantLoc = dbMerchant?.lat && dbMerchant?.lng ? { lat: dbMerchant.lat, lng: dbMerchant.lng } : null;
    const distKm = merchantLoc && customerLoc ? distanceKm(merchantLoc, customerLoc) : 3;
    const bulkyCount = lines.reduce((s, l) => s + (l.bulky ? l.quantity : 0), 0);
    const delivery = calcDeliveryFee(distKm, bulkyCount);
    const bulkySurcharge = bulkyCount * BULKY_ITEM_SURCHARGE_UGX;
    const service = calcServiceFee(subtotal);
    const serviceLabel = "5%";
    let discount = 0;
    if (appliedPromo) {
      discount = appliedPromo.type === "percent" ? Math.round(subtotal * appliedPromo.discount / 100) : appliedPromo.discount;
      discount = Math.min(discount, subtotal + delivery);
    }
    const total = Math.max(0, subtotal + delivery + service - discount);
    return { subtotal, delivery, distKm, bulkyCount, bulkySurcharge, service, serviceLabel, discount, total };
  }, [lines, dbMerchant, appliedPromo, customerLoc]);

  const morseRate = morseCfg?.rateUgx || 3800;
  const morseUsdt = Math.max(1, Math.ceil(totals.total / morseRate));

  const copyNumber = useCallback(() => {
    navigator.clipboard.writeText(merchantMomo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [merchantMomo]);

  const copyMorseDetails = async () => {
    const block = [
      `Morse payment for GoDoor (≈ ${formatUgx(totals.total)})`,
      `Amount to send: $${morseUsdt} USD`,
      `Send to this tag: @${String(dbMerchant?.morse_tag || "").replace(/^@/, "")}`,
      `Note: write your order number so the store can match it.`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const copyMorseSuccess = async () => {
    const ref = `#${String(orderCreated || "").slice(0, 8)}`;
    if (!ref) return;
    const block = [
      `Morse payment for GoDoor order ${ref}`,
      `Amount to send: $${morseUsdt} USD (≈ ${formatUgx(totals.total)})`,
      `Send to this tag: @${String(dbMerchant?.morse_tag || "").replace(/^@/, "")}`,
      `Note to include: ${ref}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const placeOrder = async () => {
    setError(null);
    setBusy(true);
    try {
      const scheduleTsISO =
        scheduleMode && scheduleTime === "1hr" ? new Date(Date.now() + 60 * 60 * 1000).toISOString() :
        scheduleMode && scheduleTime === "2hr" ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() :
        scheduleMode && scheduleTime === "tomorrow" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() :
        null;
      let slotISO = scheduleTsISO;
      try {
        const stored = window.sessionStorage.getItem("godoor-slot");
        if (stored) {
          slotISO = stored;
          window.sessionStorage.removeItem("godoor-slot");
        }
      } catch {}
      const slotTs = slotISO ? new Date(slotISO).getTime() : null;
      const order = await createOrder({
        merchant_id: merchantId || "",
        merchant_name: merchantName,
        customer_id: supabaseUser?.id || profile.email || "",
        customer_name: profile.displayName || profile.name || "Customer",
        customer_email: profile.email || "",
        customer_phone: (profile as any).phone || "",
        items: lines.map((l) => `${l.name}${l.bulky ? " [heavy]" : ""} ×${l.quantity}`).join(", "),
        line_items: lines.map((l) => ({
          productId: l.productId,
          merchantId: merchantId || l.merchantId,
          name: l.name,
          unitPriceUgx: l.unitPriceUgx,
          quantity: l.quantity,
          bulky: !!l.bulky,
        })),
        subtotal_ugx: totals.subtotal,
        delivery_fee_ugx: totals.delivery,
        service_fee_ugx: totals.service,
        total_ugx: totals.total,
        delivery_address: deliveryAddress,
        customer_lat: savedAddr?.lat || coords?.lat || 0.3533,
        customer_lng: savedAddr?.lng || coords?.lng || 32.5822,
        scheduled_for: slotTs,
        // Use payment_submitted so business sees it immediately in "payment_submitted" tab — pending is lazy and hides orders
        status: "payment_submitted",
        payment_method: paymentMethod,
        payment_confirmed: false,
        rider_name: null,
        rider_phone: null,
        notes,
      });
      setOrderCreated(order.id);
      clear();
      router.push(`/chat/${order.id}`);
      return;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Failed to place order. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleOrder = () => {
    if (!onboarded) { signup.prompt("/checkout"); return; }
    // Auto-get location: saved address > live GPS > static Kampala fallback (0.3533, 32.5822)
    // Don't block order — static fallback ensures every order has a pin on the map
    if (!savedAddr && !coords) {
      // Nudge to set precise address, but allow order with static fallback
      // The map already shows Kampala; user can drag pin later
    }
    if (paymentMethod === "momo" && !merchantMomo) {
      setError("This store hasn't set up a MoMo number yet. Choose Morse, Airtel or Cash instead.");
      return;
    }
    if (paymentMethod === "morse" && !dbMerchant?.morse_tag) {
      setError("This store hasn't confirmed a Morse tag yet. Choose another payment method.");
      return;
    }
    placeOrder();
  };

  /* ─── Success state ─── */
  if (orderCreated) {
    return (
      <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-16 pt-4">
        <div className="relative overflow-hidden rounded-2xl border border-success/30 bg-success/10 p-6 pt-8 text-center">
          {/* Confetti particles */}
          <div className="absolute inset-x-0 top-0 h-full overflow-hidden pointer-events-none">
            {Array.from({ length: 24 }).map((_, i) => (
              <ConfettiParticle key={i} index={i} />
            ))}
          </div>

          {/* Success icon with ring pulse */}
          <div className="relative mx-auto h-16 w-16">
            <div className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
            <div className="relative flex items-center justify-center h-16 w-16 rounded-full bg-success/20">
              <PartyPopper className="h-8 w-8 text-success" />
            </div>
          </div>

          <h1 className="mt-4 font-display text-2xl font-bold text-fg">Order Placed!</h1>
          <p className="mt-1 text-sm text-muted">Your order is being prepared</p>

          {/* Order number badge */}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface/80 px-4 py-1.5 border border-border">
            <span className="text-xs text-muted">Order</span>
            <span className="text-sm font-mono font-bold text-fg">#{orderCreated.slice(0, 8)}</span>
          </div>

          {/* Estimated delivery */}
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted">
            <Clock className="h-4 w-4 text-go" />
            <span>Estimated delivery: <span className="font-semibold text-fg">{deliveryEstimate(totals.distKm)}</span></span>
          </div>

          {/* Action buttons */}
          <div className="mt-6 space-y-3">
            <Link
              href={`/chat/${orderCreated}`}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-go px-5 py-3.5 text-sm font-semibold text-white hover:bg-go-2 transition card-press"
            >
              <MessageCircle className="h-4 w-4" /> Chat with merchant
            </Link>
            <Link
              href={`/orders`}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-5 py-3.5 text-sm font-medium text-fg hover:bg-elevated transition card-press"
            >
              <Truck className="h-4 w-4" /> Track your order
            </Link>
          </div>

          {/* Payment reminder */}
          <p className="mt-4 text-[11px] text-muted">
            {paymentMethod === "momo" && merchantMomo && `Send ${formatUgx(totals.total)} to ${merchantMomo} (${merchantMomoName})`}
            {paymentMethod === "momo" && !merchantMomo && `This store hasn't set up a MoMo number yet — pick another payment method.`}
            {paymentMethod === "airtel" && `Pay ${formatUgx(totals.total)} via Airtel Money on delivery`}
            {paymentMethod === "cash" && `Pay ${formatUgx(totals.total)} cash to rider on delivery`}
            {paymentMethod === "morse" && dbMerchant?.morse_tag && `Open Morse and send $${morseUsdt} (worth ≈ ${formatUgx(totals.total)}) to @${dbMerchant.morse_tag.replace(/^@/, "")} — put your order number #${orderCreated.slice(0, 8)} in the note so the business can match it.`}
          </p>
          {/* Morse: copy the full payment details with the order number for the note */}
          {paymentMethod === "morse" && dbMerchant?.morse_tag && (
            <button type="button" onClick={() => void copyMorseSuccess()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-go/30 bg-go/10 px-5 py-3 text-sm font-semibold text-go hover:bg-go/20 transition card-press">
              <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy payment details"}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ─── Empty cart ─── */
  if (!lines.length) {
    return (
      <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-16 pt-4">
        <Link href="/app" className="inline-flex items-center gap-1 text-sm text-muted"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <div className="mt-16 text-center">
          <p className="text-muted">Your cart is empty.</p>
          <Link href="/app" className="mt-4 inline-block text-go font-medium">Browse merchants</Link>
        </div>
      </div>
    );
  }

  const paymentMethods = [
    { id: "morse" as const, label: "Morse", icon: MessageCircle, color: "text-go", bg: "bg-go/10", desc: "USD to the store · recommended" },
    { id: "momo" as const, label: "MTN MoMo", icon: Smartphone, color: "text-yellow-500", bg: "bg-yellow-500/10", desc: "Mobile Money" },
    { id: "airtel" as const, label: "Airtel", icon: Smartphone, color: "text-red-500", bg: "bg-red-500/10", desc: "Airtel Money" },
    { id: "cash" as const, label: "Cash", icon: Banknote, color: "text-success", bg: "bg-success/10", desc: "Pay on delivery" },
  ];

  // Only the methods this specific business accepts (defaults to all three).
  const merchantAccepted = dbMerchant?.accepted_payments?.length ? dbMerchant.accepted_payments : ["morse", "cash", "momo"];
  const morseReady = Boolean(dbMerchant?.morse_tag);
  const availableMethods = paymentMethods.filter((m) =>
    merchantAccepted.includes(m.id) && (m.id !== "morse" || morseReady)
  );

  const scheduleOptions = [
    { value: "asap", label: "ASAP", desc: "Deliver as fast as possible" },
    { value: "1hr", label: "In 1 hour", desc: "Within the next hour" },
    { value: "2hr", label: "In 2 hours", desc: "Within the next 2 hours" },
    { value: "tomorrow", label: "Tomorrow", desc: "Schedule for tomorrow" },
  ];

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-16 pt-4 md:max-w-4xl">
      <Link href="/cart" className="inline-flex items-center gap-1 text-sm text-muted"><ArrowLeft className="h-4 w-4" /> Back to cart</Link>
      <h1 className="mt-3 font-display text-2xl font-semibold">Checkout</h1>
      {merchantName && <p className="mt-1 text-sm text-muted">{merchantName}</p>}

      {!onboarded && (
        <div className="mt-4 rounded-2xl border border-go/30 bg-go/10 p-4">
          <p className="text-sm font-semibold">Sign up to track your order</p>
          <p className="mt-0.5 text-xs text-muted">Create an account (30 sec) to chat with the business and track your delivery live.</p>
        </div>
      )}

      <div className="md:grid md:grid-cols-[1fr_360px] md:items-start md:gap-6">
      <div>
      {/* ── Delivery Address ── */}
      <div className="mt-6">
        <label className="block text-sm"><span className="text-muted">Delivery address</span></label>
        <div className="mt-2">
          <button type="button" onClick={() => setAddrSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition hover:border-go/40">
            <MapPin className="h-4 w-4 text-go shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg truncate">{deliveryAddress || "Tap to set delivery address"}</p>
            </div>
            <span className="text-[10px] text-go font-medium shrink-0">Edit</span>
          </button>
        </div>

        {/* Map preview — always show real location: saved address, live GPS, or static Kampala fallback */}
        <MapPreview lat={customerLoc.lat} lng={customerLoc.lng} />

        {/* Delivery time estimate */}
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface border border-border px-3 py-2">
          <Clock className="h-4 w-4 text-go" />
          <div>
            <p className="text-sm font-medium text-fg">
              Estimated delivery: {deliveryEstimate(totals.distKm)}
            </p>
            <p className="text-[11px] text-muted">
              {totals.distKm.toFixed(1)} km away · {scheduleMode && scheduleTime !== "asap" ? scheduleOptions.find(o => o.value === scheduleTime)?.desc : "Delivering as fast as possible"}
            </p>
          </div>
        </div>
      </div>

      {/* ── Schedule Order Toggle ── */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <button type="button" onClick={() => setScheduleMode(!scheduleMode)}
          className="flex w-full items-center justify-between rounded-xl -mx-2 px-2 transition hover:bg-elevated">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <CalendarDays className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-fg">Schedule order</p>
              <p className="text-[11px] text-muted">Pick a delivery time</p>
            </div>
          </div>
          <div className={`relative h-6 w-11 rounded-full transition-colors ${scheduleMode ? "bg-go" : "bg-border"}`}>
            <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${scheduleMode ? "translate-x-5.5" : "translate-x-0.5"}`} />
          </div>
        </button>

        {scheduleMode && (
          <div className="mt-3 grid grid-cols-2 gap-2 animate-fade-in">
            {scheduleOptions.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setScheduleTime(opt.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  scheduleTime === opt.value
                    ? "border-go bg-go/10 text-fg"
                    : "border-border bg-bg text-muted hover:bg-elevated"
                }`}>
                <p className="text-xs font-semibold">{opt.label}</p>
                <p className="text-[10px] mt-0.5 opacity-70">{opt.desc}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Payment Method Cards ── */}
      <div className="mt-4">
        <p className="text-sm text-muted mb-2">Payment method</p>
        <div className="grid grid-cols-3 gap-2">
          {availableMethods.map((m) => {
            const Icon = m.icon;
            const active = paymentMethod === m.id;
            return (
              <button key={m.id} type="button" onClick={() => { methodTouched.current = true; setPaymentMethod(m.id); }}
                className={`relative flex flex-col items-center gap-2 rounded-2xl border-2 px-2 py-4 text-center transition card-press ${
                  active
                    ? "border-go bg-go/10 shadow-sm"
                    : "border-border bg-surface hover:bg-elevated"
                }`}>
                {active && <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-go flex items-center justify-center"><Check className="h-2.5 w-2.5 text-white" /></div>}
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${m.bg}`}>
                  {m.id === "morse"
                    ? <MorseLogo markOnly className={`h-5 w-5 ${m.color}`} />
                    : <Icon className={`h-5 w-5 ${m.color}`} />}
                </div>
                <span className={`text-xs font-semibold ${active ? "text-go" : "text-fg"}`}>{m.label}</span>
                <span className="text-[10px] text-muted leading-tight">{m.desc}</span>
              </button>
            );
          })}
        </div>

        {/* MoMo payment details */}
        {paymentMethod === "momo" && merchantMomo && (
          <div className="mt-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-4 animate-fade-in">
            <p className="text-xs text-muted mb-2">Send payment to this number:</p>
            <div className="flex items-center justify-between rounded-xl bg-surface border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-yellow-500" />
                <span className="text-base font-mono font-bold text-fg">{merchantMomo}</span>
              </div>
              <button type="button" onClick={copyNumber}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated hover:bg-panel transition">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4 text-muted" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Account name: <span className="font-medium text-fg">{merchantMomoName}</span>
            </p>
          </div>
        )}

        {/* Morse payment details */}
        {paymentMethod === "morse" && dbMerchant?.morse_tag && (
          <div className="mt-3 rounded-2xl border border-go/30 bg-go/5 p-4 animate-fade-in">
            <div className="flex items-center gap-2">
              <MorseLogo markOnly className="h-4 w-4 text-go" />
              <p className="text-xs font-semibold text-fg">Pay ${morseUsdt} USD to this store&apos;s Morse tag</p>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-surface border border-go/20 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-go">@{dbMerchant.morse_tag.replace(/^@/, "")}</span>
                <span className="text-[10px] text-muted">≈ {formatUgx(totals.total)} (rate {morseRate} UGX per USD)</span>
              </div>
              <button type="button" onClick={() => void copyMorseDetails()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated hover:bg-panel transition">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4 text-muted" />}
              </button>
            </div>
            <button type="button" onClick={() => void copyMorseDetails()}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-go/30 bg-go/5 py-2 text-xs font-semibold text-go hover:bg-go/10 transition">
              <Copy className="h-3.5 w-3.5" /> {copied ? "Copied!" : "Copy full payment details"}
            </button>
            <p className="mt-2 text-[11px] text-muted">
              Note: open <a href="https://morsemoney.com/download" target="_blank" rel="noreferrer" className="font-semibold text-go">Morse</a>, send the amount above to this store&apos;s tag, and
              write <span className="font-semibold text-fg">your order number</span> as the note. The order number appears below after you place the order, and the store matches it to your order.
              This tag is the store&apos;s Morse payment identity — it stays the same unless the store requests a change through support.
            </p>
          </div>
        )}
      </div>

      {/* ── Promo Code ── */}
      <div className="mt-4">
        <p className="text-sm text-muted">Promo code</p>
        {appliedPromo ? (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-success/10 px-3 py-2.5">
            <p className="text-xs font-semibold text-success">{appliedPromo.code} — {appliedPromo.type === "percent" ? appliedPromo.discount + "% off" : "UGX " + appliedPromo.discount.toLocaleString() + " off"}</p>
            <button type="button" onClick={clearPromo} className="rounded-lg bg-danger/15 px-2.5 py-1 text-[10px] font-semibold text-danger transition hover:bg-danger/25">Remove</button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Enter code"
              className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
            <button type="button" onClick={() => { if (!applyPromo(promoCode)) setError("Invalid promo code"); else setError(null); }}
              className="shrink-0 rounded-xl bg-go px-4 py-2.5 text-xs font-semibold text-white hover:bg-go-2 transition card-press">Apply</button>
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      <label className="mt-4 block text-sm">
        <span className="text-muted">Notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, call on arrival…" className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
      </label>
      </div>
      <div className="md:sticky md:top-20">

      {/* ── Order Summary Card ── */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
        {/* Subtotal section */}
        <div className="px-4 pt-4 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-2">Order Summary</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-fg truncate mr-2">{l.name} <span className="text-muted">×{l.quantity}</span></span>
                <Price amount={l.unitPriceUgx * l.quantity} className="tabular-nums shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Fees breakdown with colored indicators */}
        <div className="border-t border-border">
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-muted" />
                <span className="text-sm text-muted">Subtotal</span>
              </div>
              <Price amount={totals.subtotal} className="tabular-nums text-sm" />
            </div>
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-go" />
                <span className="text-sm text-muted">Delivery ({totals.distKm.toFixed(1)} km)</span>
              </div>
              <Price amount={totals.delivery - totals.bulkySurcharge} className="tabular-nums text-sm" />
            </div>
            {totals.bulkySurcharge > 0 && (
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-sm text-muted">Heavy item surcharge ({totals.bulkyCount} {totals.bulkyCount === 1 ? "item" : "items"} · {formatUgx(BULKY_ITEM_SURCHARGE_UGX)} each)</span>
                </div>
                <Price amount={totals.bulkySurcharge} className="tabular-nums text-sm" />
              </div>
            )}
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-sm text-muted">Service fee ({totals.serviceLabel})</span>
              </div>
              <Price amount={totals.service} className="tabular-nums text-sm" />
            </div>
            {totals.discount > 0 && (
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span className="text-sm text-success">Discount</span>
                </div>
                <Price amount={-totals.discount} className="tabular-nums text-sm text-success" />
              </div>
            )}
          </div>
        </div>

        {/* Total row */}
        <div className="border-t border-border bg-elevated/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-fg">Total</span>
            <div className="flex items-baseline gap-2">
              <Price amount={totals.total} className="tabular-nums text-lg font-bold text-go" />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}

      <button type="button" disabled={busy} onClick={handleOrder}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-go py-3.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 card-press">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        {onboarded ? "Place order & get payment details" : "Sign up & place order"}
      </button>
      </div>
      </div>

      <SignupModal open={signup.open} onClose={() => signup.setOpen(false)} returnTo={signup.returnTo} />
    <AddressSearchModal
      open={addrSearchOpen}
      onClose={() => setAddrSearchOpen(false)}
      onSelect={(r) => {
        setSavedAddr(r);
        setAddress(r.place);
      }}
    />
    </div>
  );
}
