"use client";

/* TEMPORARY navigation-camera harness.
   Renders MapboxMap in the rider's heading-up mode with a mock rider, so the
   camera (zoom / pitch / bearing / rider screen position) can be measured in
   a real browser. Deleted once the checks pass. */

import { useState } from "react";
import dynamic from "next/dynamic";
import type { LatLng } from "@/lib/location";

const MapboxMapView = dynamic(() => import("@/components/MapboxMap"), { ssr: false });

const RIDER: LatLng = { lat: 0.3163, lng: 32.5822 };
const DEST: LatLng = { lat: 0.3305, lng: 32.5900 };

export default function NavHarness() {
  const [turnM, setTurnM] = useState<number | null>(null);

  return (
    <div className="p-4">
      <h1 className="mb-2 text-lg font-bold">Navigation camera harness</h1>
      <div className="mb-3 flex flex-wrap gap-2">
        {[null, 20, 120, 400, 1200].map((d) => (
          <button
            key={String(d)}
            type="button"
            onClick={() => setTurnM(d)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold"
          >
            turn {d == null ? "unknown" : `${d} m`}
          </button>
        ))}
      </div>

      <div className="relative h-[360px] w-full overflow-hidden rounded-2xl border border-border">
        <MapboxMapView
          center={RIDER}
          zoom={14}
          height={360}
          userLocation={RIDER}
          navigationBearing={0}
          navigationZoom={16.5}
          navigationPitch={45}
          nextTurnDistanceM={turnM}
          fitBounds={[RIDER, DEST]}
          markers={[
            { id: "rider-live", position: RIDER, isRider: true, label: "Rider", heading: 0, accuracy: 12 },
            { id: "dropoff", position: DEST, isDestination: true, label: "Delivery" },
          ]}
          route={[RIDER, { lat: 0.3220, lng: 32.5850 }, DEST]}
        />
      </div>
    </div>
  );
}
