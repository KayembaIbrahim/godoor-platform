"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Clock, Camera, Info, Loader2, CheckCircle2, Upload, MapPin, Navigation, Radio, Store, ShieldCheck, FileEdit, AtSign, Lock } from "lucide-react";
import { useSession } from "@/lib/session-store";
import { uploadStorePhoto, fetchMerchantByOwnerId, updateMerchant, apiAuthHeaders } from "@/lib/db";
import { useGeolocation, formatAccuracy, UGANDA_DISTRICTS, reverseGeocode, type LatLng } from "@/lib/location";
import { CATEGORIES } from "@/lib/categories";
import { LocationPicker } from "@/components/LocationPicker";
import { MorseLogo } from "@/components/MorseLogo";

export default function BusinessStorePage() {
  const { profile, setProfile, supabaseUser } = useSession();
  const { coords, address, status: locStatus, accuracy, refresh: refreshLoc } = useGeolocation();
  const [bName, setBName] = useState(profile.businessName || "");
  const [tagline, setTagline] = useState(profile.tagline || "");
  const [area, setArea] = useState(profile.area || "");
  const [district, setDistrict] = useState(profile.district || profile.area || "");
  const [momoNumber, setMomoNumber] = useState(profile.momoNumber || "");
  const [momoName, setMomoName] = useState(profile.momoName || "");
  const [morseTag, setMorseTag] = useState("");
  const [morseTagConfirm, setMorseTagConfirm] = useState("");
  const [morseConfirmed, setMorseConfirmed] = useState(false);
  const [morseSaving, setMorseSaving] = useState(false);
  const [morseMsg, setMorseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeTag, setChangeTag] = useState("");
  const [changePhone, setChangePhone] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [accepted, setAccepted] = useState<string[]>(["cash", "momo", "morse"]);
  const [opensAt, setOpensAt] = useState(profile.opensAt || "08:00");
  const [closesAt, setClosesAt] = useState(profile.closesAt || "22:00");
  const [category, setCategory] = useState(profile.category || CATEGORIES[0]?.id || "Food & Restaurants");
  const [businessType, setBusinessType] = useState<"goods" | "clinic">("goods");
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState(profile.storeLogoUrl || "");
  const [uploading, setUploading] = useState(false);
  const [savingDb, setSavingDb] = useState(false);
  const [loc, setLoc] = useState<LatLng>(
    profile.businessLat && profile.businessLng
      ? { lat: profile.businessLat, lng: profile.businessLng }
      : { lat: 0.3533, lng: 32.5822 },
  );

  // Auto-get user location for the business — static fallback is Kampala (0.3533, 32.5822)
  // If the business has no saved location, use live GPS as soon as it arrives
  useEffect(() => {
    if (profile.businessLat && profile.businessLng) return; // already has a saved location
    if (!coords) return;
    const isDefault = Math.abs(loc.lat - 0.3533) < 1e-6 && Math.abs(loc.lng - 32.5822) < 1e-6;
    if (isDefault) {
      setLoc(coords);
      // Auto-fill area/district from reverse geocode when GPS locks
      reverseGeocode(coords).then((addr) => {
        if (addr && !area) setArea(addr.split(",").slice(0, 2).join(",").trim());
      }).catch(() => {});
      import("@/lib/location").then(({ detectDistrict }) => {
        detectDistrict(coords).then((d) => { if (d && !district) setDistrict(d); }).catch(() => {});
      });
    }
  }, [coords, profile.businessLat, profile.businessLng]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nameReq, setNameReq] = useState<any>(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nName, setNName] = useState("");
  const [nReason, setNReason] = useState("");
  const [nBusy, setNBusy] = useState(false);
  const [nMsg, setNMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load fresh merchant data from Supabase on mount (not stale session store)
  useEffect(() => {
    if (!supabaseUser?.id) return;
    fetchMerchantByOwnerId(supabaseUser.id).then(async (m) => {
      if (m) {
        setBName(m.name || "");
        setTagline(m.tagline || "");
        setArea(m.area || "");
        setDistrict(m.district || "");
        setMomoNumber(m.momo_number || "");
        setMomoName(m.momo_name || "");
        setMorseTag(m.morse_tag || "");
        setMorseConfirmed(Boolean(m.morse_tag));
        setAccepted(m.accepted_payments && m.accepted_payments.length ? m.accepted_payments : ["cash", "momo", "morse"]);
        setOpensAt(m.opens_at || "08:00");
        setClosesAt(m.closes_at || "22:00");
        setCategory(m.category || "");
        setBusinessType(m.business_type === "clinic" ? "clinic" : "goods");
        setLogoUrl(m.logo_url || "");
        if (m.lat && m.lng) setLoc({ lat: m.lat, lng: m.lng });
        if (m.id) {
          fetch(`/api/business-name-request?merchant_id=${m.id}`, { headers: await apiAuthHeaders(false) }).then(async (r) => {
            const { requests } = await r.json().catch(() => ({}));
            if (requests?.length) setNameReq(requests[0]);
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  }, [supabaseUser?.id]);

  const CATEGORY_IDS = [...CATEGORIES.map((c) => c.id)];

  const saveToDb = async (patch: Record<string, unknown>) => {
    if (!supabaseUser?.id) return;
    try {
      const merchant = await fetchMerchantByOwnerId(supabaseUser.id);
      if (merchant) {
        await updateMerchant(merchant.id, patch);
      }
    } catch (e) { console.error("DB save error:", e); }
  };

  const save = async () => {
    setSavingDb(true);
    // Always save to session store (reliable local persistence)
    setProfile({
      businessName: bName, tagline, area, district, momoNumber, momoName,
      opensAt, closesAt, category, storeLogoUrl: logoUrl,
      businessType,
      businessLat: loc.lat,
      businessLng: loc.lng,
    });
    await saveToDb({
      tagline, area, district, momo_number: momoNumber, momo_name: momoName,
      opens_at: opensAt, closes_at: closesAt, category, logo_url: logoUrl,
      accepted_payments: accepted,
      business_type: businessType,
      lat: loc.lat,
      lng: loc.lng,
    });
    setSaved(true);
    setSavingDb(false);
    setTimeout(() => setSaved(false), 2000);
  };

  // Auto-fill area from GPS
  useEffect(() => {
    if (address && !area) setArea(address);
  }, [address]);

  const confirmMorse = async () => {
    const tag = morseTag.trim().replace(/^@/, "");
    const confirm = morseTagConfirm.trim().replace(/^@/, "");
    if (!morseTag.trim()) { setMorseMsg({ ok: false, text: "Enter your business Morse username." }); return; }
    if (tag !== confirm) { setMorseMsg({ ok: false, text: "Both fields must match — type the same tag twice to confirm." }); return; }
    const merchant = await fetchMerchantByOwnerId(supabaseUser?.id || "").catch(() => undefined);
    if (!merchant) { setMorseMsg({ ok: false, text: "Save your store first, then confirm the Morse wallet." }); return; }
    setMorseSaving(true);
    setMorseMsg(null);
    try {
      const res = await fetch("/api/morse/merchant", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ merchantId: merchant.id, tag }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof j?.error === "string" ? j.error : (j?.error?.message || "Could not save the morse tag.");
        setMorseMsg({ ok: false, text: msg });
        return;
      }
      setMorseTag(j.morseTag || tag);
      setMorseTagConfirm("");
      setMorseConfirmed(true);
      setMorseMsg({ ok: true, text: "Morse wallet confirmed — it is now your fixed payment tag and cannot be changed." });
    } catch {
      setMorseMsg({ ok: false, text: "Network error. Try again." });
    }
    setMorseSaving(false);
  };

  const requestMerchantChange = async () => {
    const tag = changeTag.trim().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,32}$/i.test(tag)) { setMorseMsg({ ok: false, text: "Use letters, numbers or underscores (3–32 characters)." }); return; }
    if (tag === morseTag.replace(/^@/, "")) { setMorseMsg({ ok: false, text: "That is the current tag — pick a different one." }); return; }
    setMorseSaving(true);
    setMorseMsg(null);
    try {
      const merchant = await fetchMerchantByOwnerId(supabaseUser?.id || "").catch(() => undefined);
      if (!merchant) { setMorseMsg({ ok: false, text: "Could not load your store. Refresh and try again." }); return; }
      const res = await fetch("/api/morse/merchant", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ merchantId: merchant.id, tag, contactPhone: changePhone.trim(), reason: changeReason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      const msg = typeof j?.error === "string" ? j.error : (j?.error?.message || (res.ok ? "Request submitted." : "Could not submit the request."));
      setMorseMsg({ ok: Boolean(res.ok || j?.changeSubmitted), text: msg });
      if (res.ok || j?.changeSubmitted) {
        setChangeTag(""); setChangePhone(""); setChangeReason("");
        setTimeout(() => { setShowChangeModal(false); setMorseMsg(null); }, 1600);
      }
    } catch {
      setMorseMsg({ ok: false, text: "Network error. Try again." });
    }
    setMorseSaving(false);
  };

  const toggleAccepted = (id: string) => {
    setAccepted((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      return next.length ? next : ["cash"];
    });
  };

  const PAYMENT_OPTIONS = [
    { id: "cash", label: "Cash on delivery" },
    { id: "momo", label: "Mobile Money" },
    { id: "morse", label: "Morse (USD)" },
  ];

  const submitNameRequest = async () => {
    if (!nName.trim()) { setNMsg({ ok: false, text: "Enter the new business name." }); return; }
    const merchant = await fetchMerchantByOwnerId(supabaseUser?.id || "").catch(() => undefined);
    if (!merchant) { setNMsg({ ok: false, text: "Business not found — save your store first." }); return; }
    setNBusy(true);
    setNMsg(null);
    try {
      const res = await fetch("/api/business-name-request", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({
          merchant_id: merchant.id,
          owner_id: supabaseUser?.id || "",
          current_name: merchant.name,
          new_name: nName.trim(),
          reason: nReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setNMsg({ ok: true, text: "Request submitted! We'll review it in the admin dashboard. Your name updates once approved." });
        setNName(""); setNReason("");
        setTimeout(() => { setShowNameModal(false); setNMsg(null); }, 2800);
        fetch(`/api/business-name-request?merchant_id=${merchant.id}`).then(async (r) => {
          const { requests } = await r.json().catch(() => ({}));
          if (requests?.length) setNameReq(requests[0]);
        }).catch(() => {});
      } else {
        setNMsg({ ok: false, text: data.error || "Failed to submit request." });
      }
    } catch {
      setNMsg({ ok: false, text: "Network error. Try again." });
    }
    setNBusy(false);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supabaseUser?.id) return;
    let uid = supabaseUser.id;
    try {
      const m = await fetchMerchantByOwnerId(supabaseUser.id);
      if (m) uid = m.id;
    } catch {}
    setUploading(true);
    try {
      const url = await uploadStorePhoto(file, uid);
      if (url) {
        setLogoUrl(url);
        // Persist to session immediately
        setProfile({ storeLogoUrl: url });
        await saveToDb({ logo_url: url });
      }
    } catch (err) {
      console.error("Photo upload failed:", err);
    }
    setUploading(false);
  };

  return (<>
    <div className="mx-auto min-h-screen max-w-6xl bg-bg pb-24 px-4 md:px-6">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/business" className="text-muted hover:text-fg"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="font-display text-lg font-semibold">Store Settings</h1>
        <button type="button" onClick={save} disabled={savingDb}
          className={`ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${saved ? "bg-success/15 text-success" : "bg-primary text-white hover:bg-primary/90"}`}>
          {savingDb ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <><CheckCircle2 className="h-3.5 w-3.5" /> Saved!</> : <><Save className="h-3.5 w-3.5" /> Save</>}
        </button>
      </div>
      <div className="px-4 pt-4 space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
        {/* Store Photo */}
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="relative grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-elevated ring-1 ring-border overflow-hidden group hover:ring-primary/40 transition">
              {logoUrl ? (
                <img src={logoUrl} alt="Store" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-8 w-8 text-dim group-hover:text-primary transition" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition">
                {uploading ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Upload className="h-5 w-5 text-white" />}
              </div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{bName || "Store name"}</p>
              <p className="text-xs text-muted">{category} · {(district || area || "Area")}</p>
              <button type="button" onClick={() => fileRef.current?.click()} className="mt-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary transition hover:bg-primary/20">
                {logoUrl ? "Change photo" : "Add store photo"}
              </button>
              {logoUrl && (
                <p className="mt-1 text-[10px] text-success flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Photo uploaded
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Business Name */}
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-2">
          <h3 className="text-xs font-semibold text-dim uppercase tracking-wider">Business Identity</h3>
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
            <p className="text-lg font-bold truncate">{bName || "Store name"}</p>
          </div>
          {nameReq && (
            <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-semibold ${nameReq.status === "approved" ? "bg-success/15 text-success" : nameReq.status === "rejected" ? "bg-danger/15 text-danger" : "bg-amber-500/15 text-amber-600"}`}>
              {nameReq.status === "approved" ? <CheckCircle2 className="h-3 w-3" /> : <FileEdit className="h-3 w-3" />}
              Name change {nameReq.status === "approved" ? "approved — live" : nameReq.status === "rejected" ? "reviewed & rejected" : "pending review"}
            </div>
          )}
          <p className="flex items-start gap-1.5 text-[10px] text-muted">
            <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5 text-success" />
            Your business name is protected. To rename, submit a request with a reason — our team reviews it, and names can be changed every 30 days.
          </p>
          <button type="button" onClick={() => setShowNameModal(true)} disabled={nameReq?.status === "pending"}
            className="mt-1 rounded-xl border border-border bg-bg px-3.5 py-2 text-xs font-semibold text-fg transition hover:border-primary/40 hover:text-primary disabled:opacity-50">
            {nameReq?.status === "pending" ? "Name change pending…" : "Request a name change"}
          </button>
        </div>

        {/* Location — drag pin, search or GPS */}
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-2">
          <h3 className="text-xs font-semibold text-dim uppercase tracking-wider">Business Location</h3>
          <p className="text-[10px] text-muted">Search for your shop, drag the pin, or use GPS. Businesses can move — update anytime.</p>
          <LocationPicker
            value={loc}
            onChange={async (newLoc) => {
              setLoc(newLoc);
              // Auto-fill area from reverse geocode
              try {
                const addr = await reverseGeocode(newLoc);
                if (addr) setArea(addr.split(",").slice(0, 2).join(",").trim());
              } catch {}
              // Auto-detect district
              import("@/lib/location").then(({ detectDistrict }) => {
                detectDistrict(newLoc).then((d) => { if (d) setDistrict(d); });
              });
            }}
            height={180}
          />
        </div>

        {/* Basic Info */}
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
          <h3 className="text-xs font-semibold text-dim uppercase tracking-wider">Basic Info</h3>
          <div><label className="text-xs text-muted">Business name</label><p className="mt-1 w-full truncate rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm text-fg">{bName || "Store name"}</p></div>
          {nameReq?.status === "pending" && <p className="flex items-center gap-1.5 text-[10px] text-amber-600"><FileEdit className="h-3 w-3" />Change pending review — your new name shows after approval.</p>}
          <div><label className="text-xs text-muted">Tagline</label><input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="What you sell in one line" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" /></div>
          <div><label className="text-xs text-muted">Business type</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(["goods", "clinic"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setBusinessType(t)}
                  className={`rounded-lg px-2 py-2.5 text-[11px] font-medium transition ${businessType === t ? "bg-primary text-white" : "bg-bg text-muted"}`}>
                  {t === "goods" ? "📦 Goods / Delivery" : "🏥 Clinic / Appointments"}
                </button>
              ))}
            </div>
            {businessType === "clinic" && <p className="mt-1.5 text-[10px] text-amber-600 flex items-center gap-1"><Info className="h-3 w-3" />Clinic mode adds appointment bookings. Your products become bookable services.</p>}
          </div>
          <div><label className="text-xs text-muted">Category</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {CATEGORY_IDS.map((c) => (
                <button key={c} type="button" onClick={() => setCategory(c)}
                  className={`rounded-lg px-2 py-2 text-[11px] font-medium transition ${category === c ? "bg-primary text-white" : "bg-bg text-muted"}`}>{c}</button>
              ))}
            </div>
          </div>
          <div><label className="text-xs text-muted">District</label><select value={district} onChange={(e) => setDistrict(e.target.value)} className="mt-1 w-full cursor-pointer rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2">
            <option value="">Select district…</option>
            {UGANDA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select></div>
          <div><label className="text-xs text-muted">Area / zone</label><input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Auto-filled from GPS" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" /></div>
        </div>

        {/* Payment */}
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
          <h3 className="text-xs font-semibold text-dim uppercase tracking-wider">Payment</h3>
          <div><label className="text-xs text-muted">MoMo number</label><input value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)} placeholder="0772 100 200" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" /></div>
          <div><label className="text-xs text-muted">Registered name</label><input value={momoName} onChange={(e) => setMomoName(e.target.value)} placeholder="Business name on MoMo" className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" /></div>
          <p className="flex items-center gap-1.5 text-[10px] text-dim"><Info className="h-3 w-3" />Customers will see this number to send payment</p>
        </div>

        {/* Morse partner wallet (fixed payment tag) */}
        <div className="rounded-2xl border border-go/40 bg-go/5 p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-dim uppercase tracking-wider">
            <MorseLogo markOnly className="h-3.5" /> Morse partner wallet (USD)
          </h3>
          {morseConfirmed ? (
            <div>
              <div className="flex items-center justify-between rounded-xl border border-go/30 bg-go/10 px-3 py-2.5">
                <span className="text-xs text-muted">Fixed business tag</span>
                <span className="font-mono text-sm font-bold text-go">@{morseTag.replace(/^@/, "")}</span>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[10px] text-muted">
                <Lock className="h-3 w-3 shrink-0 mt-0.5 text-success" />
                Customers pay USD INTO this tag. It is confirmed once — a fixed
                tag is what makes every Morse payment traceable. Need a change? Tap below and our support team will contact you to approve it.
              </p>
              {morseMsg && <p className={`mt-2 text-[11px] font-medium ${morseMsg.ok ? "text-success" : "text-danger"}`}>{morseMsg.text}</p>}
              <button type="button" onClick={() => { setShowChangeModal(true); setMorseMsg(null); }}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-go/10 px-4 py-2.5 text-xs font-semibold text-go transition hover:bg-go/20">
                <AtSign className="h-3.5 w-3.5" /> Change tag
              </button>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-muted">
                Confirm the Morse username of the person who runs this business. Customers will send USD (shown as UGX in Morse) to this
                exact tag for their orders, and you can push payment requests to their tags. It is confirmed once — you can request a
                change later through support.
              </p>
              <p className="flex items-start gap-1.5 text-[10px] text-dim">
                <Info className="h-3 w-3 shrink-0 mt-0.5" /> No Morse yet? Download the app and use GoDoor&apos;s
                friend code <strong className="text-go">AsAp4f</strong>, then confirm the handle here.
              </p>
              <input
                value={morseTag}
                onChange={(e) => { setMorseTag(e.target.value); setMorseMsg(null); }}
                placeholder="e.g. your_business_morse"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
              <input
                value={morseTagConfirm}
                onChange={(e) => { setMorseTagConfirm(e.target.value); setMorseMsg(null); }}
                placeholder="Type the same tag again to confirm"
                className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2"
              />
              {morseMsg && <p className={`text-[11px] font-medium ${morseMsg.ok ? "text-success" : "text-danger"}`}>{morseMsg.text}</p>}
              <button
                type="button"
                disabled={morseSaving || !morseTag.trim() || !morseTagConfirm.trim()}
                onClick={() => void confirmMorse()}
                className="inline-flex items-center gap-2 rounded-xl bg-go px-4 py-2 text-xs font-semibold text-white transition hover:bg-go-2 disabled:opacity-50"
              >
                {morseSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AtSign className="h-3.5 w-3.5" />}
                {morseSaving ? "Confirming…" : "Confirm my Morse username"}
              </button>
            </>
          )}

          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted">Which payment methods do you accept?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PAYMENT_OPTIONS.map((p) => {
                const on = accepted.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => toggleAccepted(p.id)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${on ? "bg-go text-white" : "bg-elevated text-muted"}`}>
                    {!on && <span className="mr-1 opacity-60">+</span>}{p.label}{on && <span className="ml-1.5 text-white/80">✓</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-dim">
              Customers only see these methods at checkout. Morse shows only once your fixed tag above is confirmed.
            </p>
          </div>
        </div>

        {/* Operating Hours */}
        <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
          <h3 className="text-xs font-semibold text-dim uppercase tracking-wider">Operating Hours</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-muted">Opens</label><input type="time" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" /></div>
            <div><label className="text-xs text-muted">Closes</label><input type="time" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" /></div>
          </div>
          <p className="flex items-center gap-1.5 text-[10px] text-dim"><Clock className="h-3 w-3" />Orders outside these hours will show &quot;Currently closed&quot;</p>
        </div>
      </div>
      {showNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowNameModal(false)} />
          <div className="relative w-full max-w-sm animate-scale-in rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <h3 className="flex items-center gap-2 text-sm font-bold"><FileEdit className="h-4 w-4 text-primary" />Request a name change</h3>
            <p className="mt-1 text-[11px] text-muted">Current name: <span className="font-semibold text-fg">{bName}</span>. Changes are reviewed and a new name can be approved every 30 days.</p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs text-muted">New business name</label>
                <input value={nName} onChange={(e) => setNName(e.target.value)} maxLength={80} placeholder="e.g. Zains Home & Furniture"
                  className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" />
              </div>
              <div>
                <label className="text-xs text-muted">Reason for the change</label>
                <textarea value={nReason} onChange={(e) => setNReason(e.target.value)} rows={3} maxLength={300} placeholder="e.g. We rebranded from Zains Furniture to Zains Home & Furniture"
                  className="mt-1 w-full resize-none rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-primary focus:ring-2" />
              </div>
              {nMsg && <p className={`text-[11px] font-medium ${nMsg.ok ? "text-success" : "text-danger"}`}>{nMsg.text}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={submitNameRequest} disabled={nBusy || !nName.trim()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 disabled:opacity-50">
                  {nBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                  {nBusy ? "Submitting…" : "Submit request"}
                </button>
                <button type="button" onClick={() => setShowNameModal(false)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted transition hover:text-fg">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setShowChangeModal(false); setMorseMsg(null); }} />
          <div className="relative w-full max-w-sm animate-scale-in rounded-2xl border border-border bg-surface p-5 shadow-2xl">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <MorseLogo markOnly className="h-4" /> Request a tag change
            </h3>
            <p className="mt-1 text-[11px] text-muted">
              Your tag is locked for safety. Our support team will contact you to approve the change before it goes live.
            </p>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-go/30 bg-go/10 px-3 py-2">
              <span className="text-[11px] text-muted">Current tag</span>
              <span className="font-mono text-xs font-bold text-go">@{morseTag.replace(/^@/, "")}</span>
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted">New Morse username</label>
                <input value={changeTag} onChange={(e) => { setChangeTag(e.target.value); setMorseMsg(null); }}
                  placeholder="e.g. new_shop_tag"
                  className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Contact number <span className="text-dim">(support will reach you here)</span></label>
                <input value={changePhone} onChange={(e) => setChangePhone(e.target.value)}
                  placeholder="e.g. 0772 100 200"
                  className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Reason <span className="text-dim">(optional)</span></label>
                <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Why are you changing?"
                  className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              {morseMsg && <p className={`text-[11px] font-medium ${morseMsg.ok ? "text-success" : "text-danger"}`}>{morseMsg.text}</p>}
              <div className="flex items-center gap-2">
                <button type="button" disabled={morseSaving || !changeTag.trim()}
                  onClick={() => void requestMerchantChange()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-go px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-go-2 disabled:opacity-50">
                  {morseSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <AtSign className="h-4 w-4" />}
                  {morseSaving ? "Submitting…" : "Submit change request"}
                </button>
                <button type="button" onClick={() => { setShowChangeModal(false); setMorseMsg(null); }}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted transition hover:text-fg">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}