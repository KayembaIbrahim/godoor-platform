"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { OnboardingShell, Field, inputCls } from "@/components/OnboardingShell";
import { MorseLogo } from "@/components/MorseLogo";
import { LocationPicker } from "@/components/LocationPicker";
import { useSession } from "@/lib/session-store";
import { apiAuthHeaders } from "@/lib/db";
import { KAMPALA, type LatLng } from "@/lib/location";

export default function CustomerOnboarding() {
  const router = useRouter();
  const { profile, setProfile, completeOnboarding, setRole } = useSession();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(profile.name ?? "");
  const [morseTag, setMorseTag] = useState(profile.morseTag ?? "");
  const [morseTagConfirm, setMorseTagConfirm] = useState("");
  const [morseErr, setMorseErr] = useState("");
  const [email, setEmail] = useState(profile.email ?? "");
  const [addressLabel, setAddressLabel] = useState("Home");
  const [address, setAddress] = useState(
    profile.addresses?.[0]?.address ?? "Your area, Uganda",
  );
  const [loc, setLoc] = useState<LatLng>(
    profile.addresses?.[0]
      ? { lat: profile.addresses[0].lat, lng: profile.addresses[0].lng }
      : KAMPALA,
  );

  const emailOk = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), [email]);
  const nameOk = name.trim().length >= 2;
  const morseOk = /^[a-z0-9_]{3,32}$/i.test(morseTag.trim().replace(/^@/, ""));

  const finish = async () => {
    setRole("customer");
    setProfile({
      email: email.trim(),
      name: name.trim(),
      morseTag: morseTag.trim(),
      addresses: [{ label: addressLabel, address: address.trim(), lat: loc.lat, lng: loc.lng }],
    });
    if (morseOk) {
      setMorseErr("");
      try {
        const res = await fetch("/api/morse/tag", {
          method: "POST",
          headers: await apiAuthHeaders(true),
          body: JSON.stringify({ tag: morseTag.trim() }),
        });
        if (res.status === 401) {
          // Not signed in yet — the account page / wallet page will save it later.
        } else {
          const j = await res.json().catch(() => ({}));
          if (!res.ok) {
            setMorseErr(j?.error || "That morse tag could not be saved.");
            return;
          }
          setProfile({ morseTag: j?.tag || morseTag.trim() });
        }
      } catch {
        // best-effort — offline allows finishing onboarding
      }
    }
    completeOnboarding();
    router.push("/onboarding/done");
  };

  return (
    <OnboardingShell
      title={step === 1 ? "Your email" : step === 2 ? "Your profile" : "Delivery address"}
      step={step}
      total={3}
      backHref={step === 1 ? "/onboarding" : undefined}
      nextLabel={step === 3 ? "Create account" : "Continue"}
      nextDisabled={
        (step === 1 && !emailOk) ||
        (step === 2 && (!nameOk || !morseOk || morseTagConfirm.trim().replace(/^@/, "").toLowerCase() !== morseTag.trim().replace(/^@/, "").toLowerCase())) ||
        false
      }
      onNext={() => {
        if (step === 3) finish();
        else setStep((s) => s + 1);
      }}
    >
      {step === 1 && (
        <div className="space-y-4">
          <Field label="Email address" hint="We'll send a verification code to this email.">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputCls}
            />
          </Field>
          {email && !emailOk && (
            <p className="text-xs text-warning">
              Please enter a valid email address.
            </p>
          )}
          <p className="rounded-xl bg-surface/60 p-3 text-xs text-muted">
            We&apos;ll email a one-time code to confirm (demo: tap Create account to continue).
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="Full name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aisha Nakato"
              className={inputCls}
            />
          </Field>
          <Field label={<span className="inline-flex items-center gap-1.5">Morse <MorseLogo markOnly className="h-3 w-3 align-middle" /></span>} hint="Your unique Morse wallet handle — confirms your Morse wallet to GoDoor.">
            <input
              value={morseTag}
              onChange={(e) => { setMorseTag(e.target.value); setMorseErr(""); }}
              placeholder="e.g. aisha_2026"
              className={inputCls}
            />
          </Field>
          <Field label="Confirm Morse username" hint="Type the same tag again — confirmed once; changes go through support.">
            <input
              value={morseTagConfirm}
              onChange={(e) => setMorseTagConfirm(e.target.value)}
              placeholder="Repeat your Morse username"
              className={inputCls}
            />
          </Field>
          {morseTag && !morseOk && (
            <p className="text-xs text-warning">
              Morse usernames use letters, numbers or underscores (3–32 characters).
            </p>
          )}
          {morseOk && morseTagConfirm && morseTag.trim().replace(/^@/, "").toLowerCase() !== morseTagConfirm.trim().replace(/^@/, "").toLowerCase() && (
            <p className="text-xs text-warning">
              The two fields must match — type the same tag twice.
            </p>
          )}
          {morseErr && <p className="text-xs text-danger">{morseErr}</p>}
          <p className="rounded-xl bg-surface/60 p-3 text-xs leading-relaxed text-muted">
            Every GoDoor user has a unique Morse username — no two GoDoor accounts share one.
            {" "}No Morse wallet yet? Download the Morse app and sign up with GoDoor&apos;s friend code{" "}
            <strong className="text-go">AsAp4f</strong> — it funds GoDoor&apos;s partnership.{" "}
            <a href="https://morsemoney.com/download" target="_blank" rel="noopener noreferrer" className="font-semibold text-go hover:underline">Download Morse →</a>
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {["Home", "Work", "Other"].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setAddressLabel(l)}
                className={`rounded-xl px-3 py-2 text-sm font-medium ${
                  addressLabel === l ? "bg-go text-white" : "bg-surface text-muted"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <Field label="Address / landmark">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, landmark, plot"
              className={inputCls}
            />
          </Field>
          <LocationPicker value={loc} onChange={setLoc} />
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Check className="h-3.5 w-3.5 text-success" />
            Pin your exact drop-off spot so riders find you fast.
          </p>
        </div>
      )}
    </OnboardingShell>
  );
}
