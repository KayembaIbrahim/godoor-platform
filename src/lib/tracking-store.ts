"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LatLng } from "./location";

export type DeliveryStatus =
  | "pending"
  | "accepted"
  | "arriving_pickup"
  | "picked_up"
  | "delivering"
  | "delivered";

export type TrackingInfo = {
  deliveryId: string;
  riderId?: string;
  merchantName: string;
  riderName: string;
  riderPhone: string;
  items: string;
  pickupLoc: LatLng;
  dropoffLoc: LatLng;
  pickupAddr: string;
  dropoffAddr: string;
  riderLoc: LatLng | null;
  status: DeliveryStatus;
  startedAt: number;
  riderHeading: number | null;
  riderSpeed: number | null;
};

type TrackingState = {
  /** Active delivery being tracked (by customer) */
  active: TrackingInfo | null;
  /** Rider's own delivery (by rider) */
  riderDelivery: TrackingInfo | null;
  /** History of past deliveries */
  history: TrackingInfo[];
  /** Start tracking a delivery */
  startTracking: (info: TrackingInfo) => void;
  /** Update rider position (called by rider) */
  updateRiderLoc: (deliveryId: string, loc: LatLng, heading?: number, speed?: number) => void;
  /** Update delivery status */
  updateStatus: (deliveryId: string, status: DeliveryStatus) => void;
  /** Set rider's own active delivery */
  setRiderDelivery: (info: TrackingInfo | null) => void;
  /** Clear tracking */
  clearTracking: () => void;
};

export const useTrackingStore = create<TrackingState>()(
  persist(
    (set) => ({
      active: null,
      riderDelivery: null,
      history: [],

      startTracking: (info) => set({ active: info }),

      updateRiderLoc: (deliveryId, loc, heading, speed) =>
        set((s) => {
          const updated = {
            riderLoc: loc,
            ...(heading != null ? { riderHeading: heading } : {}),
            ...(speed != null ? { riderSpeed: speed } : {}),
          };
          return {
            active: s.active?.deliveryId === deliveryId ? { ...s.active, ...updated } : s.active,
            riderDelivery: s.riderDelivery?.deliveryId === deliveryId ? { ...s.riderDelivery, ...updated } : s.riderDelivery,
          };
        }),

      updateStatus: (deliveryId, status) =>
        set((s) => ({
          active: s.active?.deliveryId === deliveryId ? { ...s.active, status } : s.active,
          riderDelivery: s.riderDelivery?.deliveryId === deliveryId ? { ...s.riderDelivery, status } : s.riderDelivery,
        })),

      setRiderDelivery: (info) => set({ riderDelivery: info }),

      clearTracking: () => set((s) => {
        const all = [...s.history];
        if (s.active) all.push(s.active);
        return { active: null, riderDelivery: null, history: all.slice(-20) };
      }),
    }),
    { name: "godoor-tracking" },
  ),
);
