"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, Phone, Check, MessageCircle,
  MapPin, Clock,
  CalendarDays, PartyPopper, Truck,
} from "lucide-react";
import { formatUgx, calcServiceFee, calcDeliveryFee, BULKY_PER_KG_UGX, BULKY_WEIGHT_KG_PER_ITEM } from "@/lib/utils";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { useFeeConfig } from "@/lib/use-fee-config";
import { useSession } from "@/lib/session-store";
import { useGeolocation, distanceKm } from "@/lib/location";
import { createOrder, fetchMerchantById, type DBMerchant } from "@/lib/db";
import WalletLock from "@/components/WalletLock";
import { usePromo, refreshPromoTable } from "@/lib/customer-stores";
import { SignupModal, useSignupPrompt } from "@/components/SignupPrompt";
import { AddressSearchModal, getLastAddress, rememberDetectedAddress } from "@/components/AddressSearchModal";
import { MorseLogo } from "@/components/MorseLogo";
import dynamic from "next/dynamic";

const MapboxMapView = dynamic(() => import("@/components/MapboxMap"), {
  ssr: false,
  loading: () => (
    <div className="mt-2 grid h-[120px] w-full place-items-center rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 text-xs text-muted">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-go border-t-transparent" />
        Loading map…
      </div>
    </div>
  ),
});

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

/* ─── Map preview via Mapbox ─── */
function MapPreview({ lat, lng, hasLoc }: { lat: number; lng: number; hasLoc: boolean }) {
  return (
    <div className="relative mt-2 h-[180px] w-full overflow-hidden rounded-xl border border-border">
      <MapboxMapView
        center={{ lat, lng }}
        zoom={hasLoc ? 15 : 12}
        height={180}
        markers={[{ id: "delivery", position: { lat, lng }, isDestination: true, label: hasLoc ? "Delivery" : "Kampala" }]}
      />
      {!hasLoc && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-6">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-go" />
          <p className="text-[11px] font-medium text-white">Set your address to place the drop-off pin</p>
        </div>
      )}
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
  const [address, setAddress] = useState(gpsAddress || "");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"wallet">("wallet");
  const [busy, setBusy] = useState(false);
  const [orderCreated, setOrderCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [addrSearchOpen, setAddrSearchOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("asap");
  const feeCfg = useFeeConfig();

  const [savedAddr, setSavedAddr] = useState<{ place: string; lat: number; lng: number } | null>(null);
  useEffect(() => {
    const saved = getLastAddress();
    if (saved) {
      setSavedAddr(saved);
      setAddress(saved.place);
    }
  }, []);
  const { appliedPromo, apply: applyPromo, clear: clearPromo } = usePromo();

  /**
   * Auto-fill the delivery address from the location the app already detected.
   *
   * ── The defect this replaces ──────────────────────────────────────────────
   * The checkout page read `getLastAddress()` ONCE, on mount, and never
   * persisted anything it detected. Two consequences, both reported as "the
   * location is not filled automatically":
   *
   *   1. A customer who arrived straight from a product link — never through
   *      the welcome page, never through the home screen — had no stored
   *      address at all. The app was sitting there with a perfectly good GPS
   *      fix, and the checkout still said "Tap to set delivery address" and
   *      waited for the customer to type their own street.
   *   2. `address` was seeded from `gpsAddress` at mount, which is `null` on
   *      the first render because detection has not answered yet. It was never
   *      re-seeded, so the editable field stayed empty even after the fix
   *      landed a second later.
   *
   * Now the detected place is written back to the shared store — which is how
   * it survives the navigation, and how the home screen and the checkout agree
   * on one address — and the field follows the detection as it resolves. A
   * deliberate pick is never overwritten: `rememberDetectedAddress` refuses to
   * replace a `manual` entry, and the effect below checks the same thing
   * before it touches the field.
   */
  const addrTouched = useRef(false);
  useEffect(() => {
    if (!gpsAddress || !coords) return;
    /* Write the detection back to the shared store so the home screen, the
       order sheet and this page agree on ONE address, and so it survives the
       navigation. `rememberDetectedAddress` refuses to overwrite a `manual`
       entry, so a customer who typed their own street is never undone. */
    rememberDetectedAddress(gpsAddress, coords);
    /* Only fill the field if the customer has not chosen an address
       themselves — the detection is a default, not an override. */
    if (addrTouched.current) return;
    setSavedAddr((prev) => prev ?? { place: gpsAddress, lat: coords.lat, lng: coords.lng });
    setAddress((prev) => prev || gpsAddress);
  }, [gpsAddress, coords?.lat, coords?.lng]);

  /* Load the live promo table once, so a code an admin has just retuned or
     switched off is honoured immediately instead of being judged against the
     copy that shipped with the bundle. Failure is silent and harmless — the
     server still resolves whatever code reaches it. */
  useEffect(() => {
    void refreshPromoTable();
  }, []);

  useEffect(() => {
    if (merchantId) fetchMerchantById(merchantId).then((m) => setDbMerchant(m || null));
  }, [merchantId]);

  const methodTouched = useRef(false);

  const deliveryAddress = savedAddr?.place || gpsAddress || address;
  const merchantName = dbMerchant?.name || profile.businessName || "";

  const customerLoc = useMemo(() => savedAddr?.lat && savedAddr?.lng ? { lat: savedAddr.lat, lng: savedAddr.lng }
      : coords?.lat && coords?.lng ? { lat: coords.lat, lng: coords.lng }
      : null, [savedAddr, coords]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + l.unitPriceUgx * l.quantity, 0);
    const merchantLoc = dbMerchant?.lat && dbMerchant?.lng ? { lat: dbMerchant.lat, lng: dbMerchant.lng } : null;
    const distKm = merchantLoc && customerLoc ? distanceKm(merchantLoc, customerLoc) : 3;
    const bulkyCount = lines.reduce((s, l) => s + (l.bulky ? l.quantity : 0), 0);
    // Each bulky item is assumed 10 kg for surcharge calculation
    const bulkyWeightKg = bulkyCount > 0 ? bulkyCount * BULKY_WEIGHT_KG_PER_ITEM : 0;
    const delivery = calcDeliveryFee(distKm, bulkyWeightKg);
    const bulkySurcharge = bulkyWeightKg * BULKY_PER_KG_UGX;
    const service = calcServiceFee(subtotal, feeCfg);
    const serviceLabel = `${Number(feeCfg.service_fee_percent ?? 15)}%`;
    let discount = 0;
    if (appliedPromo) {
      discount = appliedPromo.type === "percent" ? Math.round(subtotal * appliedPromo.discount / 100) : appliedPromo.discount;
      /* The clamp must match the server's, and the server discounts the GROSS
         total (subtotal + delivery + service). Clamping to subtotal + delivery
         instead let the client promise a discount the server would not honour
         — a flat code of 13,000 on a 10,000 basket quoted 1,500 to the
         customer and charged 500. */
      discount = Math.min(discount, subtotal + delivery + service);
    }
    const total = Math.max(0, subtotal + delivery + service - discount);
    return { subtotal, delivery, distKm, bulkyCount, bulkyWeightKg, bulkySurcharge, service, serviceLabel, discount, total };
  }, [lines, dbMerchant, appliedPromo, customerLoc, feeCfg]);

  /**
   * The server's own quote, and the one number that is actually charged.
   *
   * The local estimate above is a first paint: it uses whatever the browser
   * knows (a 3 km guess when the merchant row has not loaded yet). The server
   * recomputes from the merchant row and the real coordinates, so the two
   * could disagree — and a customer quoted one figure and charged another is
   * exactly the "customer and rider see different prices" complaint. The
   * server figure wins the moment it arrives.
   *
   * The request carries the BASKET, not an amount. The server resolves the
   * line-item prices itself and runs the very same `priceOrder()` that will
   * price the order, so the quote cannot drift from the charge.
   */
  const [serverQuote, setServerQuote] = useState<{
    delivery_fee_ugx: number; service_fee_ugx: number; subtotal_ugx: number;
    discount_ugx: number; total_ugx: number;
    distance_km: number; bulky_weight_kg: number; free_delivery: boolean;
  } | null>(null);

  const quoteLines = useMemo(
    () => lines.map((l) => ({ productId: l.productId, quantity: l.quantity, bulky: !!l.bulky })),
    [lines],
  );
  const quoteLat = savedAddr?.lat ?? coords?.lat ?? null;
  const quoteLng = savedAddr?.lng ?? coords?.lng ?? null;
  const quotePromoCode = appliedPromo?.code ?? null;

  useEffect(() => {
    if (!merchantId) return;
    if (quoteLat == null || quoteLng == null) { setServerQuote(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch("/api/orders/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchantId,
          customer_lat: quoteLat,
          customer_lng: quoteLng,
          line_items: quoteLines,
          promo_code: quotePromoCode,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled || !j || !j.ok) return;
          setServerQuote({
            delivery_fee_ugx: Number(j.delivery_fee_ugx) || 0,
            service_fee_ugx: Number(j.service_fee_ugx) || 0,
            subtotal_ugx: Number(j.subtotal_ugx) || 0,
            discount_ugx: Number(j.discount_ugx) || 0,
            total_ugx: Number(j.total_ugx) || 0,
            distance_km: Number(j.distance_km) || 0,
            bulky_weight_kg: Number(j.bulky_weight_kg) || 0,
            free_delivery: !!j.free_delivery,
          });
        })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [merchantId, quoteLat, quoteLng, quoteLines, quotePromoCode]);

  /** The figures the customer is shown and charged. The server wins. */
  const payable = useMemo(() => {
    if (!serverQuote) {
      return {
        delivery: totals.delivery, service: totals.service, discount: totals.discount,
        total: totals.total, subtotal: totals.subtotal,
        distKm: totals.distKm, bulkySurcharge: totals.bulkySurcharge,
      };
    }
    const delivery = serverQuote.delivery_fee_ugx;
    /* The server's subtotal is the one that will be charged: it reads the
       prices from `products`, where the local one reads a possibly-stale cart.
       The discount comes from the server's own promo resolution, so the
       figure shown here is the figure the promo will actually apply. */
    const discount = serverQuote.discount_ugx;
    /* The server's bulky weight is the one that priced the delivery, so the
       surcharge line adds up to the delivery line the customer was shown. */
    const bulkyWeightKg = serverQuote.bulky_weight_kg || totals.bulkyWeightKg;
    return {
      delivery,
      service: serverQuote.service_fee_ugx,
      discount,
      total: serverQuote.total_ugx,
      subtotal: serverQuote.subtotal_ugx,
      distKm: serverQuote.distance_km || totals.distKm,
      bulkyWeightKg,
      bulkySurcharge: serverQuote.free_delivery
        ? 0
        : Math.min(bulkyWeightKg * BULKY_PER_KG_UGX, delivery),
    };
  }, [serverQuote, totals]);

  /**
   * Wallet authorisation before the money moves.
   *
   * Checkout debits the GoDoor wallet into escrow, so this is where a customer
   * who has set a PIN or fingerprint confirms the payment. The lock is asked
   * for up front and its grant is threaded into `createOrder`; if the server
   * still answers WALLET_LOCK_REQUIRED (grant expired mid-tap, or security was
   * enrolled in another tab) we re-open the sheet rather than failing the order
   * with a raw code the customer cannot act on.
   */
  const [lockOpen, setLockOpen] = useState(false);
  const [lockMode, setLockMode] = useState<"unlock" | "setup_pin">("unlock");
  const [pendingGrant, setPendingGrant] = useState<string | null>(null);
  const placeOrder = async (grant?: string | null) => {
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
        subtotal_ugx: payable.subtotal,
        // The server recomputes every amount from the DB and ignores these —
        // they are echoed here so a stale client can never be the source of
        // truth. The value the customer was shown is `payable`.
        delivery_fee_ugx: payable.delivery,
        service_fee_ugx: payable.service,
        total_ugx: payable.total,
        delivery_address: deliveryAddress,
        // Real location only — null when GPS/address is unknown so the server
        // stores no pin instead of a fake default pin.
        // `??` not `||`: a legitimate 0 coordinate (the Equator, or lng 0) must
        // survive. `||` would throw it away and store null instead.
        customer_lat: savedAddr?.lat ?? coords?.lat ?? null,
        customer_lng: savedAddr?.lng ?? coords?.lng ?? null,
        scheduled_for: slotTs,
        // Use payment_submitted so business sees it immediately in "payment_submitted" tab — pending is lazy and hides orders
        status: "payment_submitted",
        payment_method: paymentMethod,
        payment_confirmed: false,
        rider_name: null,
        rider_phone: null,
        notes,
      }, grant ?? undefined, appliedPromo?.code);
      setOrderCreated(order.id);
      clear();
      /* Do NOT redirect here. The success screen is the confirmation the
         customer needs — order number, ETA and payment instructions all live
         on it. router.push() used to fire in the same tick as setOrderCreated,
         so the screen mounted and was immediately torn down, dropping the user
         into the chat room with no idea their order had registered. The screen
         now stays until the customer picks "Chat with merchant" or
         "Track your order". */
      return;
    } catch (e) {
      /* The grant is short-lived. If it expired between opening the sheet and
         tapping Pay, the escrow hold is refused with a specific code — re-open
         the lock instead of showing the customer a bare error for something
         they can fix in one tap. */
      const code = (e as (Error & { code?: string }) | null)?.code;
      if (code === "WALLET_LOCK_REQUIRED") {
        // Already enrolled — they just need to unlock.
        setPendingGrant(null);
        setLockMode("unlock");
        setLockOpen(true);
        return;
      }
      if (code === "WALLET_ENROLMENT_REQUIRED") {
        // Never enrolled. Asking somebody to "unlock" a PIN they never chose
        // is a dead end, so this walks them through setting one up instead.
        setPendingGrant(null);
        setLockMode("setup_pin");
        setLockOpen(true);
        return;
      }
      setError(e instanceof Error && e.message ? e.message : "Failed to place order. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleOrder = () => {
    if (!onboarded) { signup.prompt("/checkout"); return; }
    // A grant already in hand (the customer just unlocked) goes straight through.
    if (pendingGrant) { void placeOrder(pendingGrant); return; }
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
            <span>Estimated delivery: <span className="font-semibold text-fg">{deliveryEstimate(payable.distKm)}</span></span>
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
            Your payment of {formatUgx(payable.total)} is held in GoDoor Wallet escrow until delivery is confirmed.
          </p>
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

  const paymentMethods: Array<{ id: "wallet"; label: string; icon: typeof MessageCircle; color: string; bg: string; desc: string }> = [
    { id: "wallet", label: "GoDoor Wallet", icon: MessageCircle, color: "text-go", bg: "bg-go/10", desc: "Pay from your wallet balance" },
  ];

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

        {/* Map preview — real location only: saved address or live GPS */}
        <MapPreview lat={customerLoc?.lat ?? 0.3163} lng={customerLoc?.lng ?? 32.5822} hasLoc={!!customerLoc} />

        {/* Delivery time estimate */}
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-surface border border-border px-3 py-2">
          <Clock className="h-4 w-4 text-go" />
          <div>
            <p className="text-sm font-medium text-fg">
              Estimated delivery: {deliveryEstimate(payable.distKm)}
            </p>
            <p className="text-[11px] text-muted">
              {payable.distKm.toFixed(1)} km away · {scheduleMode && scheduleTime !== "asap" ? scheduleOptions.find(o => o.value === scheduleTime)?.desc : "Delivering as fast as possible"}
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

      {/* ── Payment Method ── */}
      <div className="mt-4">
        <p className="text-sm text-muted mb-2">Payment method</p>
        <div className="rounded-2xl border-2 border-go bg-go/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-go/10">
              <MorseLogo markOnly className="h-6 w-6 text-go" />
            </div>
            <div>
              <p className="text-sm font-semibold text-fg">GoDoor Wallet</p>
              <p className="text-[10px] text-muted">Pay from your Morse wallet — held in escrow until delivery</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/60 px-3 py-2">
            <MorseLogo className="h-3.5" />
            <p className="text-[10px] text-muted">
              Live rate: 1 USD = {formatUgx(feeCfg.ugx_per_usd || 4400)} UGX
            </p>
          </div>
        </div>
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
              <Price amount={payable.subtotal} className="tabular-nums text-sm" />
            </div>
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-go" />
                <span className="text-sm text-muted">Delivery ({payable.distKm.toFixed(1)} km)</span>
              </div>
              <Price amount={payable.delivery - payable.bulkySurcharge} className="tabular-nums text-sm" />
            </div>
            {payable.bulkySurcharge > 0 && (
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-sm text-muted">Heavy item surcharge ({payable.bulkyWeightKg} kg × {formatUgx(BULKY_PER_KG_UGX)}/kg)</span>
                </div>
                <Price amount={payable.bulkySurcharge} className="tabular-nums text-sm" />
              </div>
            )}
            <div className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-sm text-muted">Service fee ({totals.serviceLabel})</span>
              </div>
              <Price amount={payable.service} className="tabular-nums text-sm" />
            </div>
            {payable.discount > 0 && (
              <div className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span className="text-sm text-success">Discount</span>
                </div>
                <Price amount={-payable.discount} className="tabular-nums text-sm text-success" />
              </div>
            )}
          </div>
        </div>

        {/* Total row */}
        <div className="border-t border-border bg-elevated/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-fg">Total</span>
            <div className="flex items-baseline gap-2">
              <Price amount={payable.total} className="tabular-nums text-lg font-bold text-go" />
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
    <WalletLock
      mode={lockMode}
      open={lockOpen}
      reason={`Pay ${formatUgx(payable.total)}`}
      onCancel={() => { setLockOpen(false); setPendingGrant(null); }}
      onAuthorized={(grant) => {
        setLockOpen(false);
        // setup_pin enrols and mints a grant in one step; if it ever returns an
        // empty one, fall back to a normal attempt so the lock can be opened
        // for real rather than retrying with nothing.
        setPendingGrant(grant || null);
        void placeOrder(grant || undefined);
      }}
    />
    <AddressSearchModal
      open={addrSearchOpen}
      onClose={() => setAddrSearchOpen(false)}
      onSelect={(r) => {
        /* A deliberate pick: from here on the customer's own address wins over
           any later detection, so the drop-off pin cannot move under them. */
        addrTouched.current = true;
        setSavedAddr(r);
        setAddress(r.place);
      }}
    />
    </div>
  );
}
