"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowLeft, Store, Truck, Check, Loader2, Mail, Send } from "lucide-react";
import { Logo } from "@/components/Logo";

type Role = "business" | "rider";

const CATEGORIES = [
  "Food & Restaurants", "Groceries", "Pharmacy", "Clothing & Fashion",
  "Electronics", "Furniture & Home", "Hardware", "Beauty & Salon",
  "Supermarket", "Other",
];

const inputCls =
  "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none ring-go focus:ring-2";

export default function PartnerPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center text-muted">Loading…</div>}>
      <PartnerBody />
    </Suspense>
  );
}

function PartnerBody() {
  const params = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "rider" ? "rider" : "business");

  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (!contactName.trim()) { setError("Tell us who to contact."); return; }
    if (!email.trim() && phone.trim().length < 9) { setError("We need a valid email or phone number."); return; }
    if (role === "business" && !businessName.trim()) { setError("Enter your business name."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/partner-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          contact_name: contactName,
          email,
          phone,
          business_name: businessName,
          category,
          area,
          details,
          website, // honeypot
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Could not send your application."); setBusy(false); return; }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="hero-wash flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4">
        <div className="w-full max-w-sm text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-success/15 ring-1 ring-success/30">
            <Check className="h-8 w-8 text-success" />
          </div>
          <h1 className="font-display text-2xl font-bold">Application sent!</h1>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            Thanks {contactName.split(" ")[0] || "for your interest"}. Our team has received your application
            and will review it shortly. If approved, we will contact you at {email || phone}.
          </p>
          <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-go px-6 py-3 text-sm font-semibold text-white hover:bg-go-2 transition">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="hero-wash min-h-[calc(100dvh-3.5rem)]">
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg flex-col px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Home">
            <ArrowLeft className="h-5 w-5 text-muted hover:text-fg transition" />
          </Link>
          <Logo size="sm" />
          <span className="w-5" />
        </div>

        <div className="mt-8 text-center">
          <h1 className="font-display text-3xl font-semibold">Join GoDoor</h1>
          <p className="mt-2 text-sm text-muted">Apply today — our team reviews every application personally.</p>
        </div>

        {/* Role toggle */}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRole("business")}
            className={`flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition ${
              role === "business" ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted hover:bg-elevated"
            }`}
          >
            <Store className="h-4 w-4" /> I run a business
          </button>
          <button
            type="button"
            onClick={() => setRole("rider")}
            className={`flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition ${
              role === "rider" ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted hover:bg-elevated"
            }`}
          >
            <Truck className="h-4 w-4" /> I want to deliver or drive
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {role === "business" && (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-xs font-semibold text-muted">Business details</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted">Business name</label>
                  <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Zains Home & Furniture"
                    className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted">Category</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                    <option value="">Select a category…</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted">Area / zone</label>
                  <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Where is the business located?"
                    className={inputCls} />
                </div>
              </div>
            </div>
          )}

          {role === "rider" && (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-xs font-semibold text-muted">Transport and delivery details</p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted">Vehicle type</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                    <option value="">Select a vehicle…</option>
                    <option value="motorbike">Motorbike</option>
                    <option value="bicycle">Bicycle</option>
                    <option value="car">Car / SUV</option>
                    <option value="foot">On foot</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted">Home area</label>
                  <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Which area will you deliver in?"
                    className={inputCls} />
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-xs font-semibold text-muted">Contact details</p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted">Your name</label>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-muted" />
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name"
                    className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0772 100 200" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted">Anything else? (optional)</label>
                <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder="Tell us a bit about your business or experience"
                  className={inputCls} />
              </div>
              {/* honeypot */}
              <input value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" />
            </div>
          </div>

          {error && <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}

          <button type="button" onClick={submit} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-go py-3.5 text-sm font-semibold text-white hover:bg-go-2 disabled:opacity-50 transition card-press">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {busy ? "Sending…" : "Submit application"}
          </button>

          <p className="text-center text-[11px] text-dim">
            Applications go straight to the GoDoor team. We get back to you within a few days.
          </p>
        </div>
      </div>
    </div>
  );
}