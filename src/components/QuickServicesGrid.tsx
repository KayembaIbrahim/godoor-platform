"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bike,
  UtensilsCrossed,
  ShoppingBag,
  Package,
  Pill,
  Wallet,
  Smartphone,
  Sparkles,
  ShieldCheck,
  X,
  MapPin,
  CheckCircle2,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";
import { serviceDiscRgb } from "@/lib/category-discs";

/**
 * The eight super-app services, in the brief's order. One row, one definition.
 *
 * Each entry is either a ROUTE (`href`) or an in-page FLOW (`action`): GoRide,
 * GoFood, GoMart, GoPharma and GoPay have somewhere to go, while GoExpress,
 * Airtime and Services run through this component's own sheets — a parcel quote
 * and an airtime purchase are not pages, they are transactions.
 */
const SERVICES = [
  { id: "GoRide", label: "GoRide", sub: "Boda & Car", icon: Bike, href: "/ride", action: null },
  { id: "GoFood", label: "GoFood", sub: "Meals", icon: UtensilsCrossed, href: "/browse/food", action: null },
  { id: "GoMart", label: "GoMart", sub: "Groceries", icon: ShoppingBag, href: "/browse/mart", action: null },
  { id: "GoExpress", label: "GoExpress", sub: "Send parcel", icon: Package, href: null, action: "express" },
  { id: "GoPharma", label: "GoPharma", sub: "Prescriptions", icon: Pill, href: "/browse/pharma", action: null },
  { id: "GoPay", label: "GoPay", sub: "Wallet", icon: Wallet, href: "/wallet", action: null },
  { id: "Airtime", label: "Airtime", sub: "MTN & Airtel", icon: Smartphone, href: null, action: "airtime" },
  { id: "Services", label: "Services", sub: "All directory", icon: Sparkles, href: null, action: "services" },
] as const;

export function QuickServicesGrid() {
  const [allServicesOpen, setAllServicesOpen] = useState(false);
  const [airtimeOpen, setAirtimeOpen] = useState(false);
  const [expressOpen, setExpressOpen] = useState(false);

  // Airtime modal state
  const [airtimePhone, setAirtimePhone] = useState("");
  const [airtimeAmount, setAirtimeAmount] = useState("5000");
  const [airtimeCarrier, setAirtimeCarrier] = useState<"MTN" | "AIRTEL">("MTN");
  const [airtimeSuccess, setAirtimeSuccess] = useState(false);

  // Express parcel state
  const [parcelPickup, setParcelPickup] = useState("");
  const [parcelDropoff, setParcelDropoff] = useState("");
  const [parcelDesc, setParcelDesc] = useState("");
  const [parcelSuccess, setParcelSuccess] = useState(false);

  /**
   * Only the flows that genuinely run *inside* this component go through here.
   * Anything with a destination of its own is a <Link> now.
   */
  const handleServiceClick = (key: string) => {
    if (key === "services") {
      setAllServicesOpen(true);
    } else if (key === "airtime") {
      setAirtimeOpen(true);
    } else if (key === "express") {
      setExpressOpen(true);
    }
  };

return (
    <div className="space-y-3">
      {/* ── C. The eight super-app services ──────────────────────────────────
          The brief's identity row: GoFood, GoMart, GoPharma, GoExpress,
          GoRide, GoPay, Airtime, Services — each in a soft pastel disc with
          its label underneath.

          HORIZONTAL, NOT A 4×2 GRID. Eight discs at 68px plus gaps is ~628px
          of content, so on a 390px phone the row genuinely overflows and
          scrolls. That is the point: the full directory of every category
          lives at /categories, and each vertical lands on its own browse page
          with filters and sorting. The home page is discovery only.

          ONE DEFINITION, NOT TWO. This component already owned these eight
          tiles with their working modals, and it had become orphaned — the
          home was rendering a *different* category rail built from merchant
          data, which showed category names ("Clothing & Fashion") rather
          than the platform's services. Rendering this row instead removes the
          second, competing set. */}
      <div
        className="scrollbar-hide -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 rail-fade"
        role="list"
        aria-label="GoDoor services"
      >
        {SERVICES.map((s) => {
          const Icon = s.icon;
          const disc = (
            <span
              className="hybrid-disc h-14 w-14"
              style={{ ["--disc-rgb" as string]: serviceDiscRgb(s.id) }}
              aria-hidden="true"
            >
              <Icon className="h-6 w-6" />
            </span>
          );

          return (
            <div
              key={s.id}
              role="listitem"
              className="flex w-[68px] shrink-0 snap-start flex-col items-center gap-1.5"
            >
              {s.href ? (
                <Link
                  href={s.href}
                  className="transition-transform duration-200 active:scale-95"
                  aria-label={`${s.label} — ${s.sub}`}
                  title={`${s.label} — ${s.sub}`}
                >
                  {disc}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => handleServiceClick(s.action!)}
                  className="transition-transform duration-200 active:scale-95"
                  aria-label={`${s.label} — ${s.sub}`}
                  title={`${s.label} — ${s.sub}`}
                >
                  {disc}
                </button>
              )}
              <span className="w-full truncate text-center text-[11px] font-bold leading-tight text-fg">
                {s.label}
              </span>
              <span className="w-full truncate text-center text-[10px] leading-tight text-muted">
                {s.sub}
              </span>
            </div>
          );
        })}
      </div>

      {/* Safe Mobility Banner — brand teal, themed in both modes */}
      <div className="flex items-center justify-between rounded-2xl border border-brand/25 bg-brand/10 px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-wider text-brand">SAFE MOBILITY</span>
          <span className="text-muted">•</span>
          <span className="flex items-center gap-1 rounded-full bg-brand/12 px-2 py-0.5 text-[10px] font-medium text-brand border border-brand/25">
            <Sparkles className="h-3 w-3" aria-hidden />
            Verified Drivers
          </span>
        </div>
        <div className="grid h-7 w-7 place-items-center rounded-full bg-brand/15 text-brand">
          <Bike className="h-4 w-4" />
        </div>
      </div>

      {/* Modal: All GoDoor Services Directory */}
      {allServicesOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md animate-fade-in"
        >
          <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl border border-white/10 bg-ink p-5 text-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-white/10 pb-3 bg-ink">
              <div>
                <h3 className="font-display text-base font-bold">All GoDoor Services</h3>
                <p className="text-xs text-slate-400">Everything delivered or booked in one tap</p>
              </div>
              <button
                type="button"
                onClick={() => setAllServicesOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-slate-300 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 pt-3">
              {/* Mobility & Transport */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-go">Mobility & Delivery</p>
                <div className="mt-2 space-y-2">
                  <Link
                    href="/ride"
                    onClick={() => setAllServicesOpen(false)}
                    className="flex items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#FF5500] text-white">
                        <Bike className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">GoRide Boda</p>
                        <p className="text-xs text-slate-400">Instant motorcycle ride across Masaka & Kampala</p>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setAllServicesOpen(false);
                      setExpressOpen(true);
                    }}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#8B5CF6] text-white">
                        <Package className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">GoExpress Parcel</p>
                        <p className="text-xs text-slate-400">Same-day tracked package and document delivery</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Shopping & Food */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-go">Shopping & Food</p>
                <div className="mt-2 space-y-2">
                  <Link
                    href="/browse/food"
                    onClick={() => setAllServicesOpen(false)}
                    className="flex items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#F59E0B] text-white">
                        <UtensilsCrossed className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">GoFood Restaurants</p>
                        <p className="text-xs text-slate-400">Hot meals from local kitchens & fast food</p>
                      </div>
                    </div>
                  </Link>
                  <Link
                    href="/browse/mart"
                    onClick={() => setAllServicesOpen(false)}
                    className="flex items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#10B981] text-white">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">GoMart Groceries</p>
                        <p className="text-xs text-slate-400">Fresh vegetables, household staples & drinks</p>
                      </div>
                    </div>
                  </Link>
                  <Link
                    href="/browse/pharma"
                    onClick={() => setAllServicesOpen(false)}
                    className="flex items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#3B82F6] text-white">
                        <Pill className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">GoPharma Care</p>
                        <p className="text-xs text-slate-400">Prescription meds, wellness & first-aid essentials</p>
                      </div>
                    </div>
                  </Link>
                </div>
              </div>

              {/* Payments & Utility */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-go">Payments & Morse Pay</p>
                <div className="mt-2 space-y-2">
                  <Link
                    href="/wallet"
                    onClick={() => setAllServicesOpen(false)}
                    className="flex items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1E293B] text-white border border-white/10">
                        <Wallet className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">GoDoor Pay & Morse Escrow</p>
                        <p className="text-xs text-slate-400">Zero fee mobile money top-up & merchant checkout</p>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setAllServicesOpen(false);
                      setAirtimeOpen(true);
                    }}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#EAB308] text-white">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">Airtime & Data Bundles</p>
                        <p className="text-xs text-slate-400">Instant MTN and Airtel airtime top-up</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Airtime Top-Up */}
      {airtimeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md animate-fade-in"
        >
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-ink p-6 text-white shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setAirtimeOpen(false);
                setAirtimeSuccess(false);
              }}
              className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-slate-300 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            {airtimeSuccess ? (
              <div className="text-center py-4">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mb-3">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="font-display text-lg font-bold">Airtime Sent!</h3>
                <p className="mt-1 text-xs text-slate-300">
                  {formatUgx(Number(airtimeAmount))} dispatched to {airtimePhone} ({airtimeCarrier}).
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAirtimeOpen(false);
                    setAirtimeSuccess(false);
                  }}
                  className="mt-5 w-full rounded-xl bg-go py-2.5 text-xs font-bold text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#EAB308] text-white">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold">Instant Airtime</h3>
                    <p className="text-xs text-slate-400">MTN & Airtel Top-Up</p>
                  </div>
                </div>

                {/* Carrier selector */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setAirtimeCarrier("MTN")}
                    className={`rounded-xl py-2 text-xs font-bold transition border ${
                      airtimeCarrier === "MTN"
                        ? "bg-[#FFCC00]/20 text-[#FFCC00] border-[#FFCC00]/50"
                        : "bg-white/5 text-slate-400 border-white/10"
                    }`}
                  >
                    MTN Uganda
                  </button>
                  <button
                    type="button"
                    onClick={() => setAirtimeCarrier("AIRTEL")}
                    className={`rounded-xl py-2 text-xs font-bold transition border ${
                      airtimeCarrier === "AIRTEL"
                        ? "bg-[#ED1B24]/20 text-[#ED1B24] border-[#ED1B24]/50"
                        : "bg-white/5 text-slate-400 border-white/10"
                    }`}
                  >
                    Airtel Uganda
                  </button>
                </div>

                {/* Phone input */}
                <div className="space-y-1.5 mb-3">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Phone Number</label>
                  <input
                    type="tel"
                    placeholder="0770 000 000"
                    value={airtimePhone}
                    onChange={(e) => setAirtimePhone(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-go focus:outline-none"
                  />
                </div>

                {/* Amount presets */}
                <div className="space-y-1.5 mb-5">
                  <label className="text-[10px] uppercase font-bold text-slate-400">Select Amount</label>
                  <div className="grid grid-cols-3 gap-2">
                    {["2000", "5000", "10000", "20000", "50000"].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setAirtimeAmount(amt)}
                        className={`rounded-xl py-2 text-xs font-bold transition border ${
                          airtimeAmount === amt
                            ? "bg-go text-white border-go"
                            : "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10"
                        }`}
                      >
                        {formatUgx(Number(amt))}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!airtimePhone) return;
                    setAirtimeSuccess(true);
                  }}
                  disabled={!airtimePhone}
                  className="w-full rounded-xl bg-go py-3 text-xs font-bold text-white transition hover:bg-go/90 disabled:opacity-50"
                >
                  Pay with GoDoor Wallet ({formatUgx(Number(airtimeAmount))})
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: GoExpress Parcel Delivery */}
      {expressOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md animate-fade-in"
        >
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-ink p-6 text-white shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setExpressOpen(false);
                setParcelSuccess(false);
              }}
              className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-slate-300 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            {parcelSuccess ? (
              <div className="text-center py-4">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30 mb-3">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="font-display text-lg font-bold">Rider Dispatched!</h3>
                <p className="mt-1 text-xs text-slate-300">
                  A verified GoExpress rider is arriving at your pickup location.
                </p>
                <Link
                  href="/orders"
                  onClick={() => {
                    setExpressOpen(false);
                    setParcelSuccess(false);
                  }}
                  className="mt-5 block w-full rounded-xl bg-[#8B5CF6] py-2.5 text-center text-xs font-bold text-white"
                >
                  Track in Orders
                </Link>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#8B5CF6] text-white">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold">GoExpress Parcel</h3>
                    <p className="text-xs text-slate-400">Send packages, keys & documents</p>
                  </div>
                </div>

                <div className="space-y-3 mb-5">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Pickup Location</label>
                    <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm">
                      <MapPin className="h-4 w-4 text-go shrink-0" />
                      <input
                        type="text"
                        placeholder="Your current location"
                        value={parcelPickup}
                        onChange={(e) => setParcelPickup(e.target.value)}
                        className="w-full bg-transparent text-white placeholder-slate-500 focus:outline-none text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Delivery Destination</label>
                    <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm">
                      <MapPin className="h-4 w-4 text-purple-400 shrink-0" />
                      <input
                        type="text"
                        placeholder="Recipient address"
                        value={parcelDropoff}
                        onChange={(e) => setParcelDropoff(e.target.value)}
                        className="w-full bg-transparent text-white placeholder-slate-500 focus:outline-none text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400">Package Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Small box, keys, documents"
                      value={parcelDesc}
                      onChange={(e) => setParcelDesc(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-[#8B5CF6] focus:outline-none"
                    />
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/5 p-2.5 text-[11px] text-slate-300 flex items-center justify-between">
                    <span>Estimated fare</span>
                    <span className="font-bold text-white">UGX 3,500</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setParcelSuccess(true)}
                  className="w-full rounded-xl bg-[#8B5CF6] py-3 text-xs font-bold text-white transition hover:bg-[#7c3aed]"
                >
                  Request Express Rider
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
