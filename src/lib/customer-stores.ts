// Favorites store
"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalisePromoCode, PROMOS, type Promo } from "./promo";

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

/* ── Promo codes store ────────────────────────────────────────────────────────
 * This store only decides what the checkout *displays*. The server resolves the
 * code and decides what is actually charged, so a stale or tampered client can
 * never move a price.
 *
 * The table used to be a frozen module constant. That is what let the checkout
 * and the escrow disagree: the screen showed a discounted total while
 * `/api/orders` held the full amount. It now accepts the live table fetched
 * from `/api/promos`, falling back to the shipped defaults when that fetch is
 * unavailable — so the fallback is only ever a display detail, never a charge. */
type PromoState = {
  appliedPromo: { code: string; discount: number; type: "percent" | "flat" } | null;
  /** Live table from `/api/promos`. Undefined until it loads. */
  table: Record<string, Promo> | undefined;
  setTable: (table: Record<string, Promo>) => void;
  apply: (code: string) => boolean;
  clear: () => void;
};

export const usePromo = create<PromoState>()(
  persist(
    (set, get) => ({
      appliedPromo: null,
      table: undefined,
      setTable: (table) => set({ table }),
      apply: (code) => {
        const normalised = normalisePromoCode(code);
        if (!normalised) return false;
        // Live admin table when available; shipped defaults otherwise.
        const source = get().table ?? PROMOS;
        const hit = source[normalised];
        if (!hit || !hit.active) return false;
        set({ appliedPromo: { code: normalised, discount: hit.discount, type: hit.type } });
        return true;
      },
      clear: () => set({ appliedPromo: null }),
    }),
    // `table` is deliberately NOT persisted: it is live configuration and must
    // be re-read, not restored from a possibly days-old cache on the device.
    { name: "godoor-promo", partialize: (s) => ({ appliedPromo: s.appliedPromo }) as never },
  ),
);

/** Load the live promo table once per checkout visit. Failure is non-fatal. */
export async function refreshPromoTable(): Promise<void> {
  try {
    const res = await fetch("/api/promos", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { table?: unknown };
    if (!json || typeof json.table !== "object" || json.table === null) return;
    usePromo.getState().setTable(json.table as Record<string, Promo>);
  } catch {
    // Offline or the route is not deployed yet — the shipped defaults apply.
  }
}

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
