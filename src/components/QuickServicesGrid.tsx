"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bike,
  Sparkles,
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
 * GoFood, GoMart, GoPharma and GoPay have somewhere to go, while GoExpress
 * and Services run through this component's own sheets — a parcel quote is
 * not a page, it's a transaction. (Airtime was removed from the catalogue.)
 */
const SERVICES = [
  { id: "GoRide", label: "GoRide", sub: "Boda & Car", emoji: "🏍️", href: "/ride", action: null },
  { id: "GoFood", label: "GoFood", sub: "Meals", emoji: "🍽️", href: "/browse/food", action: null },
  { id: "GoMart", label: "GoMart", sub: "Groceries", emoji: "🛒", href: "/browse/mart", action: null },
  { id: "GoExpress", label: "GoExpress", sub: "Send parcel", emoji: "📦", href: null, action: "express" },
  { id: "GoPharma", label: "GoPharma", sub: "Prescriptions", emoji: "💊", href: "/browse/pharma", action: null },
  { id: "GoPay", label: "GoPay", sub: "Wallet", emoji: "💵", href: "/wallet", action: null },
  { id: "Services", label: "Services", sub: "All directory", emoji: "📂", href: null, action: "services" },
] as const;

export function QuickServicesGrid() {
  const [allServicesOpen, setAllServicesOpen] = useState(false);
  const [expressOpen, setExpressOpen] = useState(false);

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
    } else if (key === "express") {
      setExpressOpen(true);
    }
  };

return (
    <div className="space-y-3">
      {/* ── C. The seven super-app services ──────────────────────────────────
          GoFood, GoMart, GoPharma, GoExpress, GoRide, GoPay, Services —
          each in a soft pastel disc with its label beside it. The full
          directory of every category lives at /categories. */}
      {/* Same format as "See all" (/categories): a bordered card per service,
          44px pastel disc on the left, label + sub to its right. The old
          56px vertical stack (disc on top, label underneath) did not match
          the See All page users already like. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="list" aria-label="GoDoor services">
        {SERVICES.map((s) => {
          const disc = (
            <span
              className="hybrid-disc h-11 w-11 shrink-0"
              style={{ ["--disc-rgb" as string]: serviceDiscRgb(s.id) }}
              aria-hidden="true"
            >
              <span className="text-2xl leading-none" aria-hidden>{s.emoji}</span>
            </span>
          );
          const body = (
            <>
              {disc}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">{s.label}</span>
                <span className="block truncate text-[11px] text-muted">{s.sub}</span>
              </span>
            </>
          );

          return (
            <div key={s.id} role="listitem" className="min-w-0">
              {s.href ? (
                <Link
                  href={s.href}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-all duration-200 hover:border-go/40 hover:shadow-[0_10px_24px_-8px_rgb(0_0_0/0.22)] active:scale-[0.98] active:shadow-none"
                  aria-label={`${s.label} — ${s.sub}`}
                  title={`${s.label} — ${s.sub}`}
                >
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => handleServiceClick(s.action!)}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left transition-all duration-200 hover:border-go/40 hover:shadow-[0_10px_24px_-8px_rgb(0_0_0/0.22)] active:scale-[0.98] active:shadow-none"
                  aria-label={`${s.label} — ${s.sub}`}
                  title={`${s.label} — ${s.sub}`}
                >
                  {body}
                </button>
              )}
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
                    <span className="text-xl leading-none" aria-hidden>📦</span>
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
