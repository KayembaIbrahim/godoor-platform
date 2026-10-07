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
  ChevronRight,
  ShieldCheck,
  X,
  Store,
  PhoneCall,
  MapPin,
  Clock,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { formatUgx } from "@/lib/utils";

interface QuickServicesGridProps {
  onSelectCategory?: (category: string) => void;
  /** Shops available per canonical category id, so no tile leads to an empty list. */
  catCounts?: Record<string, number>;
}

export function QuickServicesGrid({ onSelectCategory, catCounts }: QuickServicesGridProps) {
  const [allServicesOpen, setAllServicesOpen] = useState(false);
  const [airtimeOpen, setAirtimeOpen] = useState(false);
  const [expressOpen, setExpressOpen] = useState(false);
  // Set when someone taps a category with no shops registered yet, so the tile
  // explains itself instead of silently filtering the catalogue to nothing.
  const [emptyCategory, setEmptyCategory] = useState<string | null>(null);

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

  // Category filters must be CANONICAL ids from lib/categories. This used to
  // pass the ad-hoc strings "Groceries" and "Pharmacy"; the real ids are
  // "Groceries & Market" and "Pharmacy", and the home filter compares against
  // canonical ids — so the GoMart tile silently produced an empty shop list.
  const handleServiceClick = (key: string, categoryFilter?: string) => {
    if (key === "services") {
      setAllServicesOpen(true);
    } else if (key === "airtime") {
      setAirtimeOpen(true);
    } else if (key === "express") {
      setExpressOpen(true);
    } else if (categoryFilter && onSelectCategory) {
      // No registered shops in this category yet — say so, rather than showing
      // a blank catalogue that reads like the app broke.
      if (catCounts && (catCounts[categoryFilter] || 0) === 0) {
        setEmptyCategory(categoryFilter);
        return;
      }
      setEmptyCategory(null);
      onSelectCategory(categoryFilter);
      // Smooth scroll to catalogue
      const el = document.getElementById("merchants");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="space-y-3">
      {/* 8-item Super-App Grid */}
      <div className="grid grid-cols-4 gap-y-4 gap-x-2 pt-1">
        {/* 1. GoRide */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-[#FF5500]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#FF5500] border border-[#FF5500]/30 leading-none">
            From 2.5k
          </span>
          <Link
            href="/ride"
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#FF5500] text-white shadow-lg shadow-[#FF5500]/25 transition hover:scale-105 active:scale-95"
            aria-label="GoRide - Boda & Car"
          title="GoRide - Boda & Car"
          >
            <Bike className="h-6 w-6 transition group-hover:scale-110" />
          </Link>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">GoRide</span>
          <span className="text-[10px] text-slate-400 leading-tight">Boda & Car</span>
        </div>

        {/* 2. GoFood */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-[#F59E0B]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#F59E0B] border border-[#F59E0B]/30 leading-none">
            Popular
          </span>
          <button
            type="button"
            onClick={() => handleServiceClick("food", "Food & Restaurants")}
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#F59E0B] text-white shadow-lg shadow-[#F59E0B]/25 transition hover:scale-105 active:scale-95"
            aria-label="GoFood - Meals & snacks"
          title="GoFood - Meals & snacks"
          >
            <UtensilsCrossed className="h-6 w-6 transition group-hover:scale-110" />
          </button>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">GoFood</span>
          <span className="text-[10px] text-slate-400 leading-tight">Meals</span>
        </div>

        {/* 3. GoMart */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-[#10B981]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#10B981] border border-[#10B981]/30 leading-none">
            Fresh
          </span>
          <button
            type="button"
            onClick={() => handleServiceClick("mart", "Groceries & Market")}
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#10B981] text-white shadow-lg shadow-[#10B981]/25 transition hover:scale-105 active:scale-95"
            aria-label="GoMart - Supermarket"
          title="GoMart - Supermarket"
          >
            <ShoppingBag className="h-6 w-6 transition group-hover:scale-110" />
          </button>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">GoMart</span>
          <span className="text-[10px] text-slate-400 leading-tight">Groceries</span>
        </div>

        {/* 4. GoExpress */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-[#8B5CF6]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#8B5CF6] border border-[#8B5CF6]/30 leading-none">
            Tracked
          </span>
          <button
            type="button"
            onClick={() => handleServiceClick("express")}
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#8B5CF6] text-white shadow-lg shadow-[#8B5CF6]/25 transition hover:scale-105 active:scale-95"
            aria-label="GoExpress - Send parcel"
          title="GoExpress - Send parcel"
          >
            <Package className="h-6 w-6 transition group-hover:scale-110" />
          </button>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">GoExpress</span>
          <span className="text-[10px] text-slate-400 leading-tight">Send parcel</span>
        </div>

        {/* 5. GoPharma */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-[#3B82F6]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#3B82F6] border border-[#3B82F6]/30 leading-none">
            Care
          </span>
          <button
            type="button"
            onClick={() => handleServiceClick("pharma", "Pharmacy")}
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#3B82F6] text-white shadow-lg shadow-[#3B82F6]/25 transition hover:scale-105 active:scale-95"
            aria-label="GoPharma - Prescriptions"
          title="GoPharma - Prescriptions"
          >
            <Pill className="h-6 w-6 transition group-hover:scale-110" />
          </button>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">GoPharma</span>
          <span className="text-[10px] text-slate-400 leading-tight">Prescriptions</span>
        </div>

        {/* 6. GoPay */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[9px] font-bold text-slate-300 border border-slate-600 leading-none">
            0% fee
          </span>
          <Link
            href="/wallet"
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#1E293B] text-white border border-white/10 shadow-lg transition hover:bg-[#253550] active:scale-95"
            aria-label="GoPay - Morse & Mobile Money"
          title="GoPay - Morse & Mobile Money"
          >
            <Wallet className="h-6 w-6 text-slate-200 transition group-hover:scale-110" />
          </Link>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">GoPay</span>
          <span className="text-[10px] text-slate-400 leading-tight">Wallet</span>
        </div>

        {/* 7. Airtime */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-[#EAB308]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#EAB308] border border-[#EAB308]/30 leading-none">
            Instant
          </span>
          <button
            type="button"
            onClick={() => handleServiceClick("airtime")}
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#EAB308] text-white shadow-lg shadow-[#EAB308]/25 transition hover:scale-105 active:scale-95"
            aria-label="Airtime - MTN & Airtel"
          title="Airtime - MTN & Airtel"
          >
            <Smartphone className="h-6 w-6 transition group-hover:scale-110" />
          </button>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">Airtime</span>
          <span className="text-[10px] text-slate-400 leading-tight">MTN & Airtel</span>
        </div>

        {/* 8. Services */}
        <div className="flex flex-col items-center">
          <span className="mb-1 rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[9px] font-bold text-slate-300 border border-slate-600 leading-none">
            More
          </span>
          <button
            type="button"
            onClick={() => handleServiceClick("services")}
            className="group grid h-14 w-14 place-items-center rounded-full bg-[#1E293B] text-white border border-white/10 shadow-lg transition hover:bg-[#253550] active:scale-95"
            aria-label="Services - All directory"
          title="Services - All directory"
          >
            <Sparkles className="h-6 w-6 text-slate-200 transition group-hover:scale-110" />
          </button>
          <span className="mt-1.5 text-xs font-bold text-white leading-tight">Services</span>
          <span className="text-[10px] text-slate-400 leading-tight">All directory</span>
        </div>
      </div>

      {/* A category was tapped but nothing is registered there yet. */}
      {emptyCategory && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3"
        >
          <Store className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-amber-200">
              No {emptyCategory} shops yet
            </p>
            <p className="mt-0.5 text-[11px] text-amber-100/80">
              We&apos;re onboarding partners in this category now.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href="/partner"
              className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-900 transition hover:bg-amber-300"
            >
              Register
            </Link>
            <button
              type="button"
              onClick={() => setEmptyCategory(null)}
              aria-label="Dismiss"
              className="grid h-6 w-6 place-items-center rounded-full text-amber-200/70 transition hover:text-amber-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Safe Mobility Banner */}
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#131F38] px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-wider text-slate-200">SAFE MOBILITY</span>
          <span className="text-slate-500">•</span>
          <span className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-400/20">
            <span>✨</span> Verified Drivers
          </span>
        </div>
        <div className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-slate-200">
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
          <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#131F38] p-5 text-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-white/10 pb-3 bg-[#131F38]">
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Shopping & Food */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-go">Shopping & Food</p>
                <div className="mt-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAllServicesOpen(false);
                      handleServiceClick("food", "Food & Restaurants");
                    }}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition text-left"
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAllServicesOpen(false);
                      handleServiceClick("mart", "Groceries & Market");
                    }}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition text-left"
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAllServicesOpen(false);
                      handleServiceClick("pharma", "Pharmacy");
                    }}
                    className="flex w-full items-center justify-between rounded-2xl bg-white/5 p-3 hover:bg-white/10 transition text-left"
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
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
                    <ChevronRight className="h-4 w-4 text-slate-400" />
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
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#131F38] p-6 text-white shadow-2xl">
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
          <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#131F38] p-6 text-white shadow-2xl">
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
