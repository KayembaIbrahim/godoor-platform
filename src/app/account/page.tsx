"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, type Role } from "@/lib/session-store";
import { uploadFile, getUserVerificationStatus, fetchMerchants, fetchRiders, updateRider, apiAuthHeaders } from "@/lib/db";
import { useGeolocation, formatAccuracy } from "@/lib/location";
import {
  User, MapPin, LogOut, ShieldCheck, Mail, Navigation, Radio,
  Store, Truck, ShoppingBag, Package, Wallet, Settings, Heart,
  ChevronRight, ExternalLink, Clock, Star, Bell, Camera, Check, Loader2, BadgeCheck,
  Phone, Edit3, Save, X, Bike, Zap, Car, Footprints, Lock, AtSign
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { MorseLogo } from "@/components/MorseLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import Link from "next/link";

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Store; color: string; links: { href: string; label: string; icon: typeof Store }[] }> = {
  customer: {
    label: "Customer",
    icon: ShoppingBag,
    color: "text-go",
    links: [
      { href: "/app", label: "Browse Merchants", icon: Store },
      { href: "/orders", label: "My Orders", icon: Package },
      { href: "/wallet", label: "Wallet", icon: Wallet },
    ],
  },
  business: {
    label: "Business",
    icon: Store,
    color: "text-primary",
    links: [
      { href: "/business", label: "Dashboard", icon: Store },
      { href: "/business/products", label: "Products", icon: Package },
      { href: "/business/orders", label: "Orders", icon: Bell },
      { href: "/business/earnings", label: "Earnings", icon: Wallet },
      { href: "/business/store", label: "Store Settings", icon: Settings },
      { href: "/verification", label: "Verification", icon: BadgeCheck },
    ],
  },
  rider: {
    label: "Rider",
    icon: Truck,
    color: "text-[#f97316]",
    links: [
      { href: "/rider", label: "Rider Dashboard", icon: Truck },
      { href: "/rider/earnings", label: "Earnings", icon: Wallet },
      { href: "/rider/history", label: "Delivery History", icon: Clock },
      { href: "/verification", label: "Verification", icon: BadgeCheck },
    ],
  },
};

const VEHICLES = [
  { id: "bicycle", label: "Bicycle", icon: Bike },
  { id: "motorbike", label: "Motorbike", icon: Zap },
  { id: "car", label: "Car / SUV", icon: Car },
  { id: "foot", label: "On foot", icon: Footprints },
];

export default function AccountPage() {
  const { onboarded, role, profile, reset, supabaseUser, setProfile } = useSession();
  const { coords, address, status, accuracy, refresh } = useGeolocation();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [verified, setVerified] = useState<"none" | "pending" | "approved" | "rejected">("none");

  // Edit state
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  // Phone change request modal
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneOld, setPhoneOld] = useState("");
  const [phoneNew, setPhoneNew] = useState("");
  const [phoneReason, setPhoneReason] = useState("");
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [phonePending, setPhonePending] = useState(false);

  // Morse tag change request modal (mirrors the phone flow — tag is fixed)
  const [showMorseModal, setShowMorseModal] = useState(false);
  const [morseNew, setMorseNew] = useState("");
  const [morseContact, setMorseContact] = useState("");
  const [morseReason, setMorseReason] = useState("");
  const [morseSubmitting, setMorseSubmitting] = useState(false);
  const [morseMsg, setMorseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [morsePending, setMorsePending] = useState(false);

  // First-time morse tag set (inline two-field confirm)
  const [morseTagInput, setMorseTagInput] = useState("");
  const [morseTagConfirm, setMorseTagConfirm] = useState("");
  const [morseFirstSaving, setMorseFirstSaving] = useState(false);
  const [morseFirstMsg, setMorseFirstMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Rider-specific state
  const [riderRecord, setRiderRecord] = useState<{ name: string; phone: string; vehicle_type: string; service_area: string; plate: string } | null>(null);

  // Business-specific state — the merchants table is the source of truth (not localStorage)
  const [merchantInfo, setMerchantInfo] = useState<{ name: string; category: string; area: string; momo_number: string } | null>(null);

  useEffect(() => {
    if (role !== "business" || !supabaseUser?.id) return;
    let cancelled = false;
    import("@/lib/db").then(({ fetchMerchantByOwnerId }) => {
      return fetchMerchantByOwnerId(supabaseUser.id).then((m) => {
        if (m && !cancelled) setMerchantInfo({ name: m.name || "", category: m.category || "", area: m.area || "", momo_number: m.momo_number || "" });
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [role, supabaseUser?.id]);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      const st = useSession.getState();
      const uid = st.supabaseUser?.id || "";
      const email = st.profile.email || st.supabaseUser?.email || "";
      if (!uid && !email) return;
      getUserVerificationStatus(uid, email).then((s) => { if (!cancelled) setVerified(s); }).catch(() => {});
    };
    check();
    const iv = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Fetch rider record if rider
  useEffect(() => {
    if (role !== "rider" || !supabaseUser?.id) return;
    fetchRiders().then((riders) => {
      const r = riders.find((r) => r.id === supabaseUser.id);
      if (r) setRiderRecord({ name: r.name || "", phone: r.phone || "", vehicle_type: r.vehicle_type || "motorbike", service_area: r.service_area || "", plate: r.plate || "" });
    }).catch(() => {});
  }, [role, supabaseUser?.id]);

  // Check for pending phone change request on mount
  useEffect(() => {
    if (!supabaseUser?.id) return;
    apiAuthHeaders(false).then((headers) =>
      fetch("/api/phone-change-request?mine=true", { headers }).then((r) => r.json()).then(({ requests }) => {
        const mine = (requests || []).find((r: any) => r.user_id === supabaseUser?.id);
        if (mine) setPhonePending(true);
      }).catch(() => ({})
    )).catch(() => {});
  }, [supabaseUser?.id]);

  // Check for pending Morse tag change request on mount
  useEffect(() => {
    if (!supabaseUser?.id) return;
    apiAuthHeaders(false).then((headers) =>
      fetch("/api/morse/change-request?mine=true", { headers }).then((r) => r.json()).then(({ requests }) => {
        const mine = (requests || []).find((r: any) => r.user_id === supabaseUser?.id && r.kind === "profile");
        if (mine) setMorsePending(true);
      }).catch(() => ({})
    )).catch(() => {});
  }, [supabaseUser?.id]);

  if (!onboarded || !role) {
    return (
      <div className="hero-wash flex min-h-[70vh] items-center justify-center px-4">
        <div className="text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-go/15 ring-1 ring-go/20">
            <User className="h-8 w-8 text-go" />
          </div>
          <h1 className="font-display text-2xl font-bold">Welcome to GoDoor</h1>
          <p className="mt-2 max-w-sm mx-auto text-sm text-muted">
            Sign in to view your profile, track orders, and manage your account.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Link href="/" className="flex items-center gap-2 rounded-full bg-go px-6 py-3 text-sm font-semibold text-white transition hover:bg-go-2 active:scale-[0.97]">
              <User className="h-4 w-4" /> Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const rc = ROLE_CONFIG[role] || ROLE_CONFIG.customer;
  const RoleIcon = rc.icon;
  const realName = profile.name || "";
  const publicName = profile.displayName || profile.name || "GoDoor User";
  const initial = (publicName || profile.email || "U").charAt(0).toUpperCase();
  // Display name: what other users see. Real name: legal identity, locked.
  const displayName = publicName;
  const displayEmail = supabaseUser?.email || profile.email || "No email set";
  const avatarUrl = profile.avatarUrl || "";

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supabaseUser?.id) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadFile(file, "avatars", `avatars/${supabaseUser.id}/${Date.now()}.${file.name.split(".").pop()}`);
      if (url) {
        setProfile({ avatarUrl: url });
        const sb = await import("@/lib/supabase").then((m) => m.getSupabase());
        await sb?.auth.updateUser({ data: { avatar: url } });
      }
    } catch (e) { console.error("Avatar upload failed:", e); }
    setUploadingAvatar(false);
  };

  const startEdit = (field: string, current: string) => {
    setEditingField(field);
    setEditValue(current);
  };

  // Display name change limit: max 2 per calendar year
  const canChangeDisplayName = () => {
    const changes = (profile.displayNameChanges as number[]) || [];
    const thisYear = new Date().getFullYear();
    const thisYearChanges = changes.filter((t) => new Date(t).getFullYear() === thisYear);
    return thisYearChanges.length < 2;
  };

  const displayNameChangeCount = () => {
    const changes = (profile.displayNameChanges as number[]) || [];
    const thisYear = new Date().getFullYear();
    return changes.filter((t) => new Date(t).getFullYear() === thisYear).length;
  };

  const saveField = async () => {
    if (!editingField) return;
    // Enforce display name limit
    if (editingField === "displayName" && !canChangeDisplayName()) {
      alert("You can only change your display name 2 times per year. Try again next year.");
      setEditingField(null);
      return;
    }
    // Real name can only be set once
    if (editingField === "name" && profile.name) {
      alert("Your real name is your legal identity and cannot be changed. Contact support for assistance.");
      setEditingField(null);
      return;
    }
    setSaving(true);
    try {
      // Morse username — unique per user, validated against every GoDoor account.
      if (editingField === "morseTag") {
        const res = await fetch("/api/morse/tag", {
          method: "POST",
          headers: await apiAuthHeaders(true),
          body: JSON.stringify({ tag: editValue.trim() }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(j?.error || "That morse tag could not be saved.");
          setSaving(false);
          setEditingField(null);
          return;
        }
        setProfile({ morseTag: j?.tag || editValue.trim() });
        setSaving(false);
        setEditingField(null);
        return;
      }
      if (role === "rider" && supabaseUser?.id) {
        // Save to riders table
        const riderPatch: Record<string, unknown> = { id: supabaseUser.id };
        riderPatch[editingField] = editValue;
        await updateRider(riderPatch as any);
        setRiderRecord((prev) => prev ? { ...prev, [editingField]: editValue } : null);
      }
      if (role === "business" && supabaseUser?.id) {
        // Store settings (name, category, area, MoMo) live in the merchants table
        // and are edited on /business/store. Only the PERSONAL display name is
        // written here — the "business name" your store shows elsewhere is managed
        // on the Store Settings page.
        if (editingField === "displayName") {
          try {
            const sb = (await import("@/lib/supabase")).getSupabase();
            if (sb) {
              await sb.from("profiles").upsert({ id: supabaseUser.id, display_name: editValue });
              await sb.auth.updateUser({ data: { display_name: editValue } });
            }
          } catch (e) { console.error("Display name save failed:", e); }
        }
      }
      // Save customer profile to Supabase
      if (role === "customer" && supabaseUser?.id) {
        try {
          const sb = (await import("@/lib/supabase")).getSupabase();
          if (sb) {
            const profilePatch: Record<string, unknown> = {};
            if (editingField === "displayName") profilePatch.display_name = editValue;
            else if (editingField === "name") profilePatch.name = editValue;
            else if (editingField === "phone") profilePatch.phone = editValue;
            else if (editingField === "district") profilePatch.district = editValue;
            else if (editingField === "address") profilePatch.address = editValue;
            if (Object.keys(profilePatch).length > 0) {
              await sb.from("profiles").upsert({ id: supabaseUser.id, ...profilePatch });
            }
            // Also update auth metadata
            await sb.auth.updateUser({ data: { ...profilePatch } });
          }
        } catch {}
      }
      // Always save to session store too
      const patch: Record<string, unknown> = { [editingField]: editValue };
      // Track display name change timestamps
      if (editingField === "displayName") {
        const changes = [...((profile.displayNameChanges as number[]) || []), Date.now()];
        patch.displayNameChanges = changes;
      }
      // If setting real name, mark it as locked (first time only)
      if (editingField === "name" && !profile.name) {
        patch.name = editValue;
      }
      setProfile(patch);
    } catch (e) { console.error("Save failed:", e); }
    setSaving(false);
    setEditingField(null);
  };

  const submitPhoneChange = async () => {
    if (!phoneOld.trim() || !phoneNew.trim()) { setPhoneMsg({ ok: false, text: "Fill in both phone numbers." }); return; }
    if (phoneOld === phoneNew) { setPhoneMsg({ ok: false, text: "New number must be different." }); return; }
    setPhoneSubmitting(true);
    setPhoneMsg(null);
    try {
      const res = await fetch("/api/phone-change-request", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({
          user_id: supabaseUser?.id || "",
          user_email: supabaseUser?.email || profile.email || "",
          user_name: profile.displayName || profile.name || "",
          user_role: role || "customer",
          old_phone: phoneOld.trim(),
          new_phone: phoneNew.trim(),
          reason: phoneReason.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPhoneMsg({ ok: true, text: "Request submitted! Admin will review shortly." });
        setPhonePending(true);
        setPhoneOld(""); setPhoneNew(""); setPhoneReason("");
        setTimeout(() => setShowPhoneModal(false), 2500);
      } else {
        setPhoneMsg({ ok: false, text: data.error || "Failed to submit request." });
      }
    } catch {
      setPhoneMsg({ ok: false, text: "Network error. Try again." });
    }
    setPhoneSubmitting(false);
  };

  const submitMorseChange = async () => {
    const tag = morseNew.trim().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,32}$/i.test(tag)) { setMorseMsg({ ok: false, text: "Morse usernames use letters, numbers or underscores (3–32)." }); return; }
    const currentTag = String((profile as any).morseTag || "").replace(/^@/, "");
    if (tag === currentTag) { setMorseMsg({ ok: false, text: "That is your current tag — pick a different one." }); return; }
    setMorseSubmitting(true);
    setMorseMsg(null);
    try {
      const res = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag, contactPhone: morseContact.trim() || undefined, reason: morseReason.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setProfile({ morseTag: j?.tag || tag });
        setMorseMsg({ ok: true, text: "Morse tag confirmed." });
        setMorseNew(""); setMorseContact(""); setMorseReason("");
        setTimeout(() => { setShowMorseModal(false); setMorseMsg(null); }, 1800);
        return;
      }
      if (j?.changeSubmitted) {
        setMorseMsg({ ok: true, text: "Request submitted! Our support team will contact you to approve it before it goes live." });
        setMorsePending(true);
        setMorseNew(""); setMorseContact(""); setMorseReason("");
        return;
      }
      const msg = typeof j?.error === "string" ? j.error : (j?.error?.message || "Could not submit the change request.");
      setMorseMsg({ ok: false, text: msg });
    } catch {
      setMorseMsg({ ok: false, text: "Network error. Try again." });
    }
    setMorseSubmitting(false);
  };

  const confirmFirstMorseTag = async () => {
    const tag = morseTagInput.trim().replace(/^@/, "");
    const confirm = morseTagConfirm.trim().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,32}$/i.test(tag)) { setMorseFirstMsg({ ok: false, text: "Morse usernames use letters, numbers or underscores (3–32)." }); return; }
    if (tag !== confirm) { setMorseFirstMsg({ ok: false, text: "Both fields must match. Type the same tag twice." }); return; }
    setMorseFirstSaving(true);
    setMorseFirstMsg(null);
    try {
      const res = await fetch("/api/morse/tag", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ tag }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setProfile({ morseTag: j?.tag || tag });
        setMorseFirstMsg({ ok: true, text: "Morse tag confirmed." });
        setMorseTagInput(""); setMorseTagConfirm("");
        return;
      }
      if (j?.changeSubmitted) {
        setMorseFirstMsg({ ok: true, text: "Request submitted! Our support team will contact you to approve it before it goes live." });
        setMorsePending(true);
        setMorseTagInput(""); setMorseTagConfirm("");
        return;
      }
      const msg = typeof j?.error === "string" ? j.error : (j?.error?.message || "Could not save your morse tag.");
      setMorseFirstMsg({ ok: false, text: msg });
    } catch {
      setMorseFirstMsg({ ok: false, text: "Network error. Try again." });
    }
    setMorseFirstSaving(false);
  };

  const FieldRow = ({ label, field, value, editable = true, icon: Icon }: { label: string; field: string; value: string; editable?: boolean; icon: typeof User }) => {
    const isEditing = editingField === field;
    return (
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {isEditing ? (
          <div className="flex items-center gap-2 px-3 py-3">
            <Icon className="h-4 w-4 shrink-0 text-go" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-go uppercase tracking-wider">{label}</p>
              <input value={editValue} onChange={(e) => setEditValue(e.target.value)}
                placeholder={`Enter ${label.toLowerCase()}`}
                className="mt-1 w-full rounded-lg border border-go/30 bg-bg px-3 py-2 text-sm outline-none ring-1 ring-go focus:ring-2" autoFocus />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button type="button" onClick={saveField} disabled={saving}
                className="grid h-8 w-8 place-items-center rounded-xl bg-success text-white transition hover:bg-success/90 active:scale-95">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => setEditingField(null)}
                className="grid h-8 w-8 place-items-center rounded-xl bg-elevated text-muted transition hover:bg-panel active:scale-95">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : editable ? (
          <button type="button" onClick={() => startEdit(field, value)}
            className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-elevated active:scale-[0.99]">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/10">
              <Icon className="h-4 w-4 text-go" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-dim uppercase tracking-wider">{label}</p>
              <p className="mt-0.5 text-sm font-medium text-fg truncate">{value || "Not set"}</p>
            </div>
            <Edit3 className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ) : (
          <div className="flex w-full items-center gap-3 px-3 py-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/10">
              <Icon className="h-4 w-4 text-go" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-dim uppercase tracking-wider">{label}</p>
              <p className="mt-0.5 text-sm font-medium text-fg truncate">{value || "Not set"}</p>
            </div>
            <Lock className="h-4 w-4 shrink-0 text-muted" />
          </div>
        )}
      </div>
    );
  };

  const UGANDA_DISTRICTS = ["Masaka", "Kampala", "Wakiso", "Mukono", "Jinja", "Mbale", "Mbarara", "Gulu", "Lira", "Arua", "Fort Portal", "Hoima", "Kabale", "Soroti", "Tororo"];

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-bg px-4 pb-24 pt-4">
      {/* Avatar + Name */}
      <div className="rounded-2xl border border-border bg-surface p-5 text-center">
        <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
        <button type="button" onClick={() => avatarRef.current?.click()}
          className="relative mx-auto h-20 w-20 overflow-hidden rounded-full bg-go/15 ring-2 ring-go/30 transition hover:ring-go">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-go">{initial}</span>
          )}
          <div className="absolute bottom-0 right-0 grid h-6 w-6 place-items-center rounded-full bg-go text-white">
            {uploadingAvatar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          </div>
        </button>
        {role === "business" && (
          <p className="mt-2 text-[10px] text-dim">This is your personal profile photo — the store logo is set in Store Settings.</p>
        )}
        <h1 className="mt-3 font-display text-xl font-bold">{displayName}</h1>
        <p className="text-xs text-muted">{displayEmail}</p>
        <span className={`mt-2 inline-flex items-center gap-1 rounded-full bg-go/15 px-2.5 py-1 text-[10px] font-semibold capitalize ${rc.color}`}>
          <RoleIcon className="h-3 w-3" /> {rc.label}
        </span>
        {verified === "approved" && (
          <span className="mt-2 ml-1 inline-flex items-center gap-0.5 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-semibold text-success">
            <BadgeCheck className="h-3 w-3" /> Verified
          </span>
        )}
        {verified === "pending" && (
          <span className="mt-2 ml-1 inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-semibold text-warning">
            <Clock className="h-3 w-3" /> Under review
          </span>
        )}
      </div>

      {/* Editable Profile Fields */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4 space-y-2">
        <h3 className="text-xs font-semibold text-dim uppercase tracking-wider mb-2">Profile Details</h3>
        {/* Real name — locked as legal identity */}
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-elevated/50 opacity-80">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/10">
            <ShieldCheck className="h-4 w-4 text-go" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-dim uppercase tracking-wider">
              Real Name {profile.name ? <span className="ml-1 text-success">· locked</span> : ""}
            </p>
            <p className="mt-0.5 text-sm font-medium text-fg truncate">{profile.name || "Set at signup"}</p>
          </div>
          {!profile.name && (
            <button type="button" onClick={() => startEdit("name", "")} className="rounded-lg bg-go/10 px-2.5 py-1 text-xs font-semibold text-go transition hover:bg-go/20">
              Set once
            </button>
          )}
        </div>

        {/* Display name — editable, limited to 2x per year */}
        <FieldRow label="Display Name" field="displayName" value={displayName} icon={User} />
        {role === "business" && (
          <p className="px-1 text-[10px] text-dim">
            This is your <span className="font-semibold text-fg">personal</span> name — the store name your customers
            see is separate, under <span className="font-medium text-go">Your Store</span> below.
          </p>
        )}
        <FieldRow label="Email" field="email" value={displayEmail} icon={Mail} />
        {/* Phone — not directly editable, requires admin approval */}
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex w-full items-center gap-3 px-3 py-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/10">
              <Phone className="h-4 w-4 text-go" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-dim uppercase tracking-wider">Phone Number</p>
              <p className="mt-0.5 text-sm font-medium text-fg truncate">{(profile as any).phone || riderRecord?.phone || "Not set"}</p>
            </div>
            {phonePending ? (
              <span className="text-[10px] font-semibold text-warning bg-warning/15 px-2.5 py-1 rounded-full">Pending review</span>
            ) : (
              <button type="button" onClick={() => { setShowPhoneModal(true); setPhoneMsg(null); }}
                className="text-xs font-semibold text-go bg-go/10 px-3 py-1.5 rounded-full hover:bg-go/20 transition">
                Request change
              </button>
            )}
          </div>
        </div>

        {/* Morse username — set once; changes require support approval */}
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex w-full items-center gap-3 px-3 py-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/10">
              <MorseLogo markOnly className="h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-dim uppercase tracking-wider">
                Morse Username {(profile as any).morseTag ? <span className="ml-1 text-success">· confirmed</span> : ""}
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-fg truncate">
                {(profile as any).morseTag ? `@${String((profile as any).morseTag).replace(/^@/, "")}` : "Not set"}
              </p>
            </div>
            {(profile as any).morseTag ? (
              morsePending ? (
                <span className="text-[10px] font-semibold text-warning bg-warning/15 px-2.5 py-1 rounded-full">Pending review</span>
              ) : (
                <button type="button" onClick={() => { setShowMorseModal(true); setMorseMsg(null); }}
                  className="text-xs font-semibold text-go bg-go/10 px-3 py-1.5 rounded-full hover:bg-go/20 transition">
                  Request change
                </button>
              )
            ) : (
              <Lock className="h-4 w-4 shrink-0 text-muted" />
            )}
          </div>
          {/* Inline first-time set form with two confirm fields */}
          {!(profile as any).morseTag && (
            <div className="border-t border-border px-3 py-3 space-y-2">
              {role === "business" ? (
                <p className="text-[10px] text-dim">
                  Choose YOUR personal Morse username — this is your own account&apos;s wallet identity (used when you buy, or for gas-fee top-up). Customers pay your business through the Store&apos;s Morse tag, which you set in Store Settings. Confirmed once; you can request a change anytime through support.
                </p>
              ) : role === "rider" ? (
                <p className="text-[10px] text-dim">
                  Choose your Morse username — confirm your Morse wallet to GoDoor and use it for any purchases. Delivery earnings are paid via mobile money. Confirmed once; you can request a change anytime through support.
                </p>
              ) : (
                <p className="text-[10px] text-dim">
                  Choose your Morse username — businesses send you Morse payment requests for your purchases. Confirmed once; you can request a change anytime through support.
                </p>
              )}
              <input
                value={morseTagInput}
                onChange={(e) => { setMorseTagInput(e.target.value); setMorseFirstMsg(null); }}
                placeholder="e.g. jane_doe"
                autoFocus
                className="w-full rounded-lg border border-go/30 bg-bg px-3 py-2.5 text-sm font-mono outline-none ring-1 ring-go focus:ring-2"
              />
              <input
                value={morseTagConfirm}
                onChange={(e) => { setMorseTagConfirm(e.target.value); setMorseFirstMsg(null); }}
                placeholder="Type the same tag again to confirm"
                className="w-full rounded-lg border border-go/30 bg-bg px-3 py-2.5 text-sm font-mono outline-none ring-1 ring-go focus:ring-2"
              />
              {morseFirstMsg && (
                <p className={`text-[11px] font-medium ${morseFirstMsg.ok ? "text-success" : "text-danger"}`}>{morseFirstMsg.text}</p>
              )}
              <button
                type="button"
                onClick={() => void confirmFirstMorseTag()}
                disabled={morseFirstSaving || !morseTagInput.trim() || !morseTagConfirm.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-go px-4 py-2 text-xs font-semibold text-white transition hover:bg-go-2 disabled:opacity-50"
              >
                {morseFirstSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AtSign className="h-3.5 w-3.5" />}
                {morseFirstSaving ? "Confirming…" : "Confirm my Morse username"}
              </button>
              <p className="text-[10px] text-dim">
                No Morse yet? Download the app and use GoDoor&apos;s friend code <strong className="text-go">AsAp4f</strong>, then confirm the handle here.
              </p>
            </div>
          )}
        </div>

        {role === "rider" && (
          <>
            <FieldRow label="Vehicle" field="vehicleType" value={(profile as any).vehicleType || riderRecord?.vehicle_type || "motorbike"} icon={Zap} />
            <FieldRow label="Plate" field="plate" value={(profile as any).plate || riderRecord?.plate || ""} icon={Car} />
            <FieldRow label="Service Area" field="serviceArea" value={(profile as any).serviceArea || riderRecord?.service_area || ""} icon={MapPin} />
          </>
        )}

        {role === "business" && (
          <>
            <div className="flex items-center gap-2 px-1 pt-2">
              <Store className="h-3.5 w-3.5 text-primary" />
              <h4 className="text-xs font-semibold text-primary uppercase tracking-wider">Your Store</h4>
            </div>
            <p className="px-1 pb-1 text-[10px] text-dim">All store details (category, area, MoMo number, logo, hours, payment methods) live in Store Settings — managed there, shown here as a snapshot.</p>
            <div className="rounded-xl border border-border bg-elevated/40 overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-go/10">
                  <Store className="h-4 w-4 text-go" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-dim uppercase tracking-wider">Store Name</p>
                  <p className="mt-0.5 text-sm font-medium text-fg truncate">{merchantInfo?.name || (profile as any).businessName || "Not set"}</p>
                  {merchantInfo?.category && <p className="text-[11px] text-muted truncate">{merchantInfo.category}{merchantInfo.area ? ` · ${merchantInfo.area}` : ""}</p>}
                </div>
                {(verified === "approved" || (merchantInfo as any)?.verified === true) ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-semibold text-success">
                    <BadgeCheck className="h-3 w-3" /> Verified
                  </span>
                ) : (
                  <Link href="/verification"
                    className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-semibold text-warning hover:bg-warning/25 transition">
                    <Clock className="h-3 w-3" /> Verify store
                  </Link>
                )}
              </div>
              <Link href="/business/store"
                className="flex items-center justify-between border-t border-border bg-primary/5 px-3 py-3 text-left transition hover:bg-primary/10 active:scale-[0.99]">
                <span className="flex items-center gap-3">
                  <Settings className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Store logo, hours, payments &amp; location</span>
                </span>
                <span className="text-xs font-semibold text-primary">Manage in Store Settings</span>
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Quick Links */}
      <div className="mt-4 space-y-2">
        {rc.links.map((link) => {
          const LinkIcon = link.icon;
          return (
            <Link key={link.href} href={link.href}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition hover:bg-elevated hover:border-go/30">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
                <LinkIcon className="h-5 w-5 text-go" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-fg">{link.label}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted" />
            </Link>
          );
        })}
      </div>

      {/* GPS */}
      <div className="mt-4">
        <button type="button" onClick={refresh}
          className="w-full rounded-2xl border border-border bg-surface p-4 text-left transition hover:bg-elevated">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
              <MapPin className="h-5 w-5 text-go" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-fg">Live GPS Location</p>
              <p className="text-xs text-muted">
                {address || (coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "Not detected")}
              </p>
              {status === "watching" && accuracy != null && (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-success">
                  <Radio className="h-2.5 w-2.5 animate-pulse" />{formatAccuracy(accuracy)}
                </p>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Appearance locked to light per business request — no toggle */}
      <div className="hidden" aria-hidden />

      {/* Sign Out */}
      <div className="mt-6">
        <button type="button" onClick={() => { reset(); window.location.href = "/"; }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger/10 py-3 text-sm font-semibold text-danger hover:bg-danger/20 transition">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>

      <div className="mt-8 text-center">
        <Logo size="sm" className="justify-center" />
        <p className="mt-2 text-xs text-dim">A ZentechX company</p>
      </div>

      {/* Phone Change Request Modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowPhoneModal(false); setPhoneMsg(null); }} />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-bg p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <button type="button" onClick={() => { setShowPhoneModal(false); setPhoneMsg(null); }}
              className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition">
              <span className="text-lg">×</span>
            </button>
            <div className="mb-4 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
                <Phone className="h-5 w-5 text-go" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Change Phone Number</h2>
                <p className="text-xs text-muted">Admin approval required</p>
              </div>
            </div>
            {phoneMsg && (
              <div className={`mb-3 rounded-xl border px-3 py-2.5 text-xs ${phoneMsg.ok ? "border-success/25 bg-success/10 text-success" : "border-danger/25 bg-danger/10 text-danger"}`}>
                {phoneMsg.text}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted">Current phone number (for verification)</label>
                <input value={phoneOld} onChange={(e) => setPhoneOld(e.target.value)} placeholder="e.g. 0772 100 200"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">New phone number</label>
                <input value={phoneNew} onChange={(e) => setPhoneNew(e.target.value)} placeholder="e.g. 0701 300 400"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Reason (optional)</label>
                <input value={phoneReason} onChange={(e) => setPhoneReason(e.target.value)} placeholder="Why are you changing?"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <button type="button" onClick={submitPhoneChange} disabled={phoneSubmitting || !phoneOld || !phoneNew}
                className="w-full rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
                {phoneSubmitting ? "Submitting..." : "Submit request"}
              </button>
              <p className="text-center text-[10px] text-dim">Admin will review your request. You will see the update in your profile.</p>
            </div>
          </div>
        </div>
      )}

      {/* Morse Tag Change Request Modal */}
      {showMorseModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowMorseModal(false); setMorseMsg(null); }} />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-bg p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <button type="button" onClick={() => { setShowMorseModal(false); setMorseMsg(null); }}
              className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition">
              <span className="text-lg">×</span>
            </button>
            <div className="mb-4 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-go/10">
                <MorseLogo markOnly className="h-6" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Change Morse tag</h2>
                <p className="text-xs text-muted">Admin approval required</p>
              </div>
            </div>
            {morseMsg && (
              <div className={`mb-3 rounded-xl border px-3 py-2.5 text-xs ${morseMsg.ok ? "border-success/25 bg-success/10 text-success" : "border-danger/25 bg-danger/10 text-danger"}`}>
                {morseMsg.text}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted">New Morse username</label>
                <input value={morseNew} onChange={(e) => setMorseNew(e.target.value)} placeholder="e.g. my_new_tag"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-mono outline-none ring-go focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Phone so support can reach you (optional)</label>
                <input value={morseContact} onChange={(e) => setMorseContact(e.target.value)} placeholder="e.g. 0772 100 200"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Reason (optional)</label>
                <input value={morseReason} onChange={(e) => setMorseReason(e.target.value)} placeholder="Why are you changing?"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2" />
              </div>
              <button type="button" onClick={submitMorseChange} disabled={morseSubmitting || !morseNew.trim()}
                className="w-full rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition">
                {morseSubmitting ? "Submitting..." : "Submit request"}
              </button>
              <p className="text-center text-[10px] text-dim">Your tag is locked for safety. Our team contacts you to approve this before it goes live.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
