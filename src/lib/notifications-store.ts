"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Notification = {
  id: string;
  title: string;
  body: string;
  orderId?: string;
  role?: string;
  read: boolean;
  createdAt: number;
};

type NotificationsState = {
  items: Notification[];
  addNotification: (n: Omit<Notification, "id" | "read" | "createdAt">) => void;
  markAllRead: () => void;
  clearAll: () => void;
  unreadCount: (role?: string | null) => number;
};

const DOOR_ICON = "/door-icon.png";

export function requestNotificationPermission() {
  try {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    // Not supported — in-app bell still works
  }
}

/** Build a rich one-line summary of an order for notification bodies. */
export function orderSummary(o: {
  items?: string | null;
  subtotal_ugx?: number;
  total_ugx?: number;
  delivery_fee_ugx?: number;
  customer_name?: string;
  merchant_name?: string;
  delivery_address?: string;
}): string {
  const parts: string[] = [];
  if (o.customer_name) parts.push(o.customer_name);
  if (o.merchant_name) parts.push(o.merchant_name);
  const items = o.items || "items";
  const total = (o.total_ugx || o.subtotal_ugx || 0) + (o.delivery_fee_ugx || 0);
  parts.push(`${items} · UGX ${total.toLocaleString()}`);
  if (o.delivery_address) parts.push(o.delivery_address);
  return parts.join(" — ");
}

export const useNotifications = create<NotificationsState>()(
  persist(
    (set, get) => ({
      items: [],
      unreadCount: (role) =>
        get().items.filter((n) => !n.read && (!n.role || !role || n.role === role)).length,
      addNotification: (n) => {
        const item: Notification = {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ...n,
          read: false,
          createdAt: Date.now(),
        };
        set((s) => ({ items: [item, ...s.items].slice(0, 50) }));
        // Fire a native browser notification when the tab is in the background so
        // merchants/riders still hear about orders while working elsewhere.
        try {
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            document.visibilityState === "hidden"
          ) {
            new Notification(item.title.replace(/_/g, " "), { body: item.body, icon: DOOR_ICON });
          }
        } catch {
          // Native notifications unavailable — bell covers it.
        }
      },
      markAllRead: () => set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),
      clearAll: () => set({ items: [] }),
    }),
    { name: "godoor-notifications" },
  ),
);
