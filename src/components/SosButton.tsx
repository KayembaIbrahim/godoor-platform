"use client";

import { useState } from "react";
import { ShieldAlert, Phone } from "lucide-react";
import { apiAuthHeaders } from "@/lib/db";

/**
 * One-tap SOS for an active ride or delivery.
 *
 * On tap:
 * 1) POST /api/sos — records the incident server-side and pushes an
 *    urgent alert to the other trip participant.
 * 2) Immediately offers a tel: link to the emergency line plus a
 *    Google Maps share link with the caller's live coordinates.
 *
 * Location is captured at tap time (one short GPS read) — no always-on
 * tracking, no screen change. The user stays on the trip screen.
 */
export function SosButton({ rideId, orderId }: { rideId?: string; orderId?: string }) {
  const [busy, setBusy] = useState(false);
  const [emergencyPhone, setEmergencyPhone] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trigger = async () => {
    if (busy || sent) return;
    setBusy(true);
    try {
      let lat: number | null = null, lng: number | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 })
        );
        lat = pos.coords.latitude; lng = pos.coords.longitude;
      } catch {}

      const r = await fetch("/api/sos", {
        method: "POST",
        headers: await apiAuthHeaders(true),
        body: JSON.stringify({ rideId, orderId, lat, lng }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) {
        setEmergencyPhone(j.emergencyPhone || null);
        setShareUrl(j.shareUrl || null);
        setSent(true);
      }
    } catch {} finally { setBusy(false); }
  };

  return (
    <div className="mt-3">
      {!sent ? (
        <button
          type="button"
          onClick={trigger}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-danger/15 px-4 py-3 text-sm font-bold text-danger transition active:scale-[0.98] disabled:opacity-60"
          aria-label="SOS emergency"
        >
          <ShieldAlert className="h-4 w-4" />
          {busy ? "Alerting…" : "SOS — Emergency help"}
        </button>
      ) : (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3">
          <p className="text-center text-xs font-bold text-danger">SOS sent — help is coming.</p>
          <div className="mt-2 flex gap-2">
            {emergencyPhone && (
              <a href={`tel:${emergencyPhone}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-danger px-3 py-2.5 text-xs font-bold text-white">
                <Phone className="h-3.5 w-3.5" /> Call emergency line
              </a>
            )}
            {shareUrl && (
              <a href={shareUrl} target="_blank" rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface px-3 py-2.5 text-xs font-bold text-fg border border-border">
                Share my location
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
