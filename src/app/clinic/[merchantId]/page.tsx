"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Star, MapPin, Clock, BadgeCheck, Stethoscope, CalendarClock, Timer, ChevronRight, X, Loader2 } from "lucide-react";
import { fetchMerchantById, fetchProducts, type DBMerchant, type DBProduct } from "@/lib/db";
import { Price } from "@/components/Price";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session-store";

type Slot = { value: string; label: string; desc: string; iso: string | null };

function buildSlots(): Slot[] {
  const now = Date.now();
  return [
    { value: "asap", label: "ASAP · Walk-in", desc: "Come in now, we slot you right in", iso: null },
    { value: "1hr", label: "In 1 hour", desc: "Arrive in about an hour", iso: new Date(now + 60 * 60 * 1000).toISOString() },
    { value: "2hr", label: "In 2 hours", desc: "Arrive in about two hours", iso: new Date(now + 2 * 60 * 60 * 1000).toISOString() },
    { value: "tomorrow", label: "Tomorrow", desc: "Book for tomorrow", iso: new Date(now + 24 * 60 * 60 * 1000).toISOString() },
  ];
}

export default function ClinicPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.merchantId || params.id || "");
  const [merchant, setMerchant] = useState<DBMerchant | null>(null);
  const [services, setServices] = useState<DBProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DBProduct | null>(null);
  const [slot, setSlot] = useState<Slot>(buildSlots()[0]);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState("");
  const { add, clear, merchantId: cartMerchantId } = useCart();
  const { onboarded } = useSession();

  useEffect(() => {
    (async () => {
      const m = await fetchMerchantById(id);
      setMerchant(m || null);
      if (m) {
        const prods = await fetchProducts(m.id);
        setServices(prods.filter((p) => p.available && p.is_service === true));
      }
      setLoading(false);
    })();
  }, [id]);

  const isOpen = merchant ? (() => {
    const now = new Date();
    const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return current >= (merchant.opens_at || "08:00") && current <= (merchant.closes_at || "22:00");
  })() : true;

  const bookNow = async () => {
    if (!selected || !merchant) return;
    setBooking(true);
    setBookError("");
    try {
      if (cartMerchantId && cartMerchantId !== merchant.id) clear();
      add({ productId: selected.id, merchantId: merchant.id, name: selected.name, unitPriceUgx: selected.price, bulky: false });
      try {
        if (slot.iso) window.sessionStorage.setItem("godoor-slot", slot.iso);
        else window.sessionStorage.removeItem("godoor-slot");
      } catch {}
      router.push("/checkout");
    } catch {
      setBookError("Could not start checkout. Try again.");
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-go border-t-transparent" />
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center px-4 text-center">
        <div>
          <p className="text-lg font-semibold">Clinic not found</p>
          <Link href="/" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-go px-4 py-2 text-sm font-semibold text-white hover:bg-go-2 transition">
            <ArrowLeft className="h-4 w-4" /> Browse
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg pb-32">
      {/* Header */}
      <div className="border-b border-border bg-surface/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-muted hover:text-fg transition"><ArrowLeft className="h-5 w-5" /></Link>
          {merchant.logo_url && (
            <img src={merchant.logo_url} alt={merchant.name} className="h-10 w-10 rounded-xl object-cover ring-1 ring-border" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="font-display text-lg font-semibold truncate">{merchant.name}</h1>
              {merchant.verified && <BadgeCheck className="h-4 w-4 text-primary shrink-0" />}
            </div>
            <p className="text-[10px] text-muted">{merchant.tagline || "Medical clinic"}</p>
          </div>
          <span className="rounded-full bg-go/15 px-2.5 py-0.5 text-[10px] font-semibold text-go">Clinic</span>
        </div>
      </div>

      {/* Info */}
      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center gap-4 text-xs text-dim flex-wrap">
          <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" />{merchant.rating}</span>
          <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-go" />{merchant.district || merchant.area || "Uganda"}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{merchant.opens_at}–{merchant.closes_at}</span>
        </div>
        <div className="flex items-center gap-2">
          {isOpen ? (
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-semibold text-success">Open now</span>
          ) : (
            <span className="rounded-full bg-danger/15 px-2.5 py-0.5 text-[10px] font-semibold text-danger">Closed</span>
          )}
          <span className="text-[10px] text-dim">Book your visit online — pay at the clinic or with Mobile Money / Morse</span>
        </div>
      </div>

      {/* Services */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10">
            <Stethoscope className="h-4 w-4 text-primary" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold">Our services</h2>
            <p className="text-[10px] text-muted">Tap a service to book an appointment</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 space-y-2.5">
        {services.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-elevated">
              <Stethoscope className="h-6 w-6 text-dim" />
            </div>
            <p className="text-sm font-medium text-fg">No services listed yet</p>
            <p className="mt-1 text-xs text-muted">The clinic hasn&apos;t published bookable services yet.</p>
          </div>
        ) : (
          services.map((s) => (
            <button key={s.id} type="button" onClick={() => { setSelected(s); setSlot(buildSlots()[0]); }}
              className="flex w-full items-center gap-3.5 rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-primary/30 active:scale-[0.99]">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
                <Stethoscope className="h-5 w-5 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{s.name}</p>
                  {s.duration_minutes ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-dim">
                      <Timer className="h-3 w-3" />{s.duration_minutes} min
                    </span>
                  ) : null}
                </div>
                {s.description && <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{s.description}</p>}
                <div className="mt-1"><Price amount={s.price} className="text-sm font-bold text-go" /></div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-dim" />
            </button>
          ))
        )}
      </div>

      {/* Booking sheet */}
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-surface p-5 pb-8 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-semibold">{selected.name}</p>
                <p className="text-xs text-muted mt-0.5">{selected.duration_minutes ? `${selected.duration_minutes} min visit · ` : ""}per visit</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="grid h-8 w-8 place-items-center rounded-full bg-elevated text-muted hover:text-fg transition"><X className="h-4 w-4" /></button>
            </div>
            <Price amount={selected.price} className="mt-2 font-display text-lg font-bold text-go" />

            <p className="mt-5 mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-dim uppercase tracking-wider"><CalendarClock className="h-3 w-3" />When will you come in?</p>
            <div className="grid grid-cols-2 gap-2">
              {buildSlots().map((s) => (
                <button key={s.value} type="button" onClick={() => setSlot(s)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${slot.value === s.value ? "border-go bg-go/10 text-fg" : "border-border bg-bg text-muted hover:bg-elevated"}`}>
                  <p className="text-xs font-semibold">{s.label}</p>
                  <p className="mt-0.5 text-[10px] opacity-70">{s.desc}</p>
                </button>
              ))}
            </div>

            {!onboarded && (
              <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-700">
                You&apos;ll be asked to sign in to book and pay.
              </p>
            )}
            {bookError && <p className="mt-3 text-xs text-danger">{bookError}</p>}

            <button type="button" onClick={bookNow} disabled={booking}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-go px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-go/30 transition hover:bg-go-2 active:scale-[0.98] disabled:opacity-60">
              {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Book & pay
            </button>
            <p className="mt-2 text-center text-[10px] text-dim">You can change your visit time after booking.</p>
          </div>
        </div>
      )}
    </div>
  );
}