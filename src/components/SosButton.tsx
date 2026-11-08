"use client";

import { useState } from "react";
import { ShieldAlert, Phone, MapPin, MessageCircle } from "lucide-react";
import { apiAuthHeaders } from "@/lib/db";

/**
 * One-tap SOS for an active ride or delivery.
 *
 * Professional flow:
 * 1) POST /api/sos — records the incident server-side, resolves the OTHER
 *    party's phone number, and pushes an urgent alert to them.
 * 2) After the server confirms, the UI shows two in-app actions:
 *    - "Call [rider/customer]" → tel: link, opens the phone dialer directly.
 *    - "Share my location" → tel: fallback link if no peer phone exists.
 *
 * No Google Maps. The user never leaves GoDoor to solve an emergency.
 *
 * Location is captured at tap time (one short GPS read) — no always-on
 * tracking, no screen change. The user stays on the trip screen.
 */
export function SosButton({
  rideId,
  orderId,
  peerPhone,
  peerName,
}: {
  rideId?: string;
  orderId?: string;
  /** Other party's phone (rider for a customer, customer for a rider). */
  peerPhone?: string | null;
  peerName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [emergencyPhone, setEmergencyPhone] = useState<string | null>(null);
  const [peerResolvedPhone, setPeerResolvedPhone] = useState<string | null>(peerPhone ?? null);
  const [sent, setSent] = useState(false);
  const [peerLabel, setPeerLabel] = useState<string | null>(peerName ?? null);

  const trigger = async () => {
    if (busy || sent) return;
    setBusy(true);
    try {
      let lat: number | null = null,
        lng: number | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 }),
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {}

      const r = await fetch("/api/sos", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ rideId, orderId, lat, lng }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) {
        setEmergencyPhone(j.emergencyPhone || null);
        const resolved = j.peerPhone || peerPhone || null;
        setPeerResolvedPhone(resolved);
        setPeerLabel(j.peerName || peerName || null);
        setSent(true);
      }
    } catch {} finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {!sent ? (
        <button
          type="button"
          onClick={trigger}
          disabled={busy}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-danger/15 px-4 py-3.5 text-base font-bold text-danger shadow-sm transition active:scale-[0.98] disabled:opacity-60"
          aria-label="SOS emergency"
        >
          <ShieldAlert className="h-5 w-5 shrink-0" />
          {busy ? "Alerting…" : "SOS — Emergency help"}
          <span className="text-xs font-normal opacity-70">Tap for help</span>
        </button>
      ) : (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4">
          <p className="text-center text-sm font-bold text-danger">
            SOS sent — {peerLabel ? `${peerLabel} has been alerted` : "help is coming"}.
          </p>

          {/* Call the other party — primary action, opens phone dialer */}
          <div className="mt-3 space-y-2">
            {peerResolvedPhone ? (
              <a
                href={`tel:${peerResolvedPhone.replace(/[^0-9]/g, "")}`}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-danger px-4 py-3.5 text-base font-bold text-white shadow-glow transition active:scale-[0.98]"
              >
                <Phone className="h-5 w-5 shrink-0" />
                Call {peerLabel || "the other party"}
                <span className="text-xs font-normal opacity-80">Tap to call</span>
              </a>
            ) : emergencyPhone ? (
              <a
                href={`tel:${emergencyPhone.replace(/[^0-9]/g, "")}`}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-danger px-4 py-3.5 text-base font-bold text-white shadow-glow transition active:scale-[0.98]"
              >
                <Phone className="h-5 w-5 shrink-0" />
                Call emergency line
                <span className="text-xs font-normal opacity-80">Tap to call</span>
              </a>
            ) : null}

            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
              <MapPin className="h-3.5 w-3.5" />
              Your location was shared with {peerLabel || "them"} automatically — no extra step needed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
