"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartLine = {
  productId: string;
  merchantId: string;
  name: string;
  unitPriceUgx: number;
  quantity: number;
  bulky?: boolean;
};

type CartState = {
  merchantId: string | null;
  merchantName: string | null;
  lines: CartLine[];
  add: (line: Omit<CartLine, "quantity"> & { quantity?: number }) => void;
  setQty: (productId: string, quantity: number) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      merchantId: null,
      merchantName: null,
      lines: [],
      add: (line) => {
        const state = get();
        const qty = line.quantity ?? 1;
        if (state.merchantId && state.merchantId !== line.merchantId) {
          set({
            merchantId: line.merchantId,
            merchantName: null,
            lines: [
              {
                productId: line.productId,
                merchantId: line.merchantId,
                name: line.name,
                unitPriceUgx: line.unitPriceUgx,
                quantity: qty,
                bulky: !!line.bulky,
              },
            ],
          });
          return;
        }
        const existing = state.lines.find((l) => l.productId === line.productId);
        if (existing) {
          set({
            merchantId: line.merchantId,
            lines: state.lines.map((l) =>
              l.productId === line.productId
                ? { ...l, quantity: l.quantity + qty }
                : l,
            ),
          });
        } else {
          set({
            merchantId: line.merchantId,
            lines: [
              ...state.lines,
              {
                productId: line.productId,
                merchantId: line.merchantId,
                name: line.name,
                unitPriceUgx: line.unitPriceUgx,
                quantity: qty,
                bulky: !!line.bulky,
              },
            ],
          });
        }
      },
      setQty: (productId, quantity) => {
        if (quantity <= 0) {
          const lines = get().lines.filter((l) => l.productId !== productId);
          set({
            lines,
            merchantId: lines.length ? get().merchantId : null,
          });
          return;
        }
        set({
          lines: get().lines.map((l) =>
            l.productId === productId ? { ...l, quantity } : l,
          ),
        });
      },
      clear: () => set({ lines: [], merchantId: null, merchantName: null }),
      count: () => get().lines.reduce((s, l) => s + l.quantity, 0),
      subtotal: () =>
        get().lines.reduce((s, l) => s + l.unitPriceUgx * l.quantity, 0),
    }),
    { name: "godoor-cart" },
  ),
);
