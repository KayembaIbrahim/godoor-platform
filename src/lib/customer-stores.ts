// Favorites store
"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type FavState = {
  merchantIds: string[];
  toggle: (id: string) => void;
  isFav: (id: string) => boolean;
};

export const useFavorites = create<FavState>()(
  persist(
    (set, get) => ({
      merchantIds: [],
      toggle: (id) => set((s) => ({
        merchantIds: s.merchantIds.includes(id)
          ? s.merchantIds.filter((x) => x !== id)
          : [...s.merchantIds, id],
      })),
      isFav: (id) => get().merchantIds.includes(id),
    }),
    { name: "godoor-favorites" },
  ),
);

// Rating store
type RatingState = {
  ratings: Record<string, { stars: number; text: string; at: number }>;
  rate: (orderId: string, stars: number, text: string) => void;
  getRating: (orderId: string) => { stars: number; text: string; at: number } | null;
};

export const useRatings = create<RatingState>()(
  persist(
    (set, get) => ({
      ratings: {},
      rate: (orderId, stars, text) => set((s) => ({
        ratings: { ...s.ratings, [orderId]: { stars, text, at: Date.now() } },
      })),
      getRating: (orderId) => get().ratings[orderId] || null,
    }),
    { name: "godoor-ratings" },
  ),
);

// Promo codes store
type PromoState = {
  appliedPromo: { code: string; discount: number; type: "percent" | "flat" } | null;
  apply: (code: string) => boolean;
  clear: () => void;
};

const VALID_PROMOS: Record<string, { discount: number; type: "percent" | "flat" }> = {
  "GODOOR10": { discount: 10, type: "percent" },
  "WELCOME": { discount: 5000, type: "flat" },
  "FIRSTORDER": { discount: 15, type: "percent" },
  "FREEDEL": { discount: 2000, type: "flat" },
};

export const usePromo = create<PromoState>()(
  persist(
    (set) => ({
      appliedPromo: null,
      apply: (code) => {
        const promo = VALID_PROMOS[code.toUpperCase()];
        if (promo) { set({ appliedPromo: { code: code.toUpperCase(), ...promo } }); return true; }
        return false;
      },
      clear: () => set({ appliedPromo: null }),
    }),
    { name: "godoor-promo" },
  ),
);

// Saved addresses store
type AddressState = {
  addresses: { id: string; label: string; address: string; lat: number; lng: number }[];
  addAddress: (a: { label: string; address: string; lat: number; lng: number }) => void;
  removeAddress: (id: string) => void;
  defaultAddress: string | null;
  setDefault: (id: string) => void;
};

export const useAddresses = create<AddressState>()(
  persist(
    (set) => ({
      addresses: [],
      addAddress: (a) => set((s) => ({
        addresses: [...s.addresses, { ...a, id: `addr_${Date.now().toString(36)}` }],
      })),
      removeAddress: (id) => set((s) => ({
        addresses: s.addresses.filter((a) => a.id !== id),
      })),
      defaultAddress: null,
      setDefault: (id) => set({ defaultAddress: id }),
    }),
    { name: "godoor-addresses" },
  ),
);
