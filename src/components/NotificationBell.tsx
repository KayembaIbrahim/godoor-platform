"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, Package, CheckCircle2, Truck, Clock, X } from "lucide-react";
import { useNotifications, type Notification } from "@/lib/notifications-store";
import { useSession } from "@/lib/session-store";

const ICONS: Record<string, typeof Bell> = {
  payment_confirmed: CheckCircle2,
  preparing: Clock,
  rider_assigned: Truck,
  delivering: Truck,
  delivered: CheckCircle2,
};

const COLORS: Record<string, string> = {
  payment_confirmed: "text-success",
  preparing: "text-go",
  rider_assigned: "text-primary",
  delivering: "text-go",
  delivered: "text-success",
};

function timeAgo(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}

export function NotificationBell() {
  const { role } = useSession();
  const { items, unreadCount, markAllRead } = useNotifications();
  const myItems = items.filter((n) => !n.role || !role || n.role === role);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unread = unreadCount(role);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open && unread > 0) markAllRead(); }}
        className="relative rounded-full p-2 text-muted hover:bg-elevated hover:text-fg transition"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-go text-[8px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between px-3 pb-2 border-b border-border">
              <p className="text-xs font-semibold">Notifications</p>
              {myItems.length > 0 && (
                <button type="button" onClick={() => markAllRead()} className="rounded-lg bg-go/10 px-2.5 py-1 text-[10px] font-semibold text-go transition hover:bg-go/20">Mark all read</button>
              )}
            </div>
            {myItems.length === 0 ? (
              <div className="py-6 text-center">
                <Bell className="mx-auto h-6 w-6 text-dim" />
                <p className="mt-1.5 text-[11px] text-muted">No notifications yet</p>
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {myItems.slice(0, 20).map((n) => {
                  const Icon = ICONS[n.title] || Package;
                  const col = COLORS[n.title] || "text-muted";
                  return (
                    <div key={n.id} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition hover:bg-elevated ${!n.read ? "bg-go/5" : ""}`}>
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-go/10 ${col}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium capitalize">{n.title.replace(/_/g, " ")}</p>
                        <p className="text-[10px] text-muted leading-snug">{n.body}</p>
                        <p className="mt-0.5 text-[9px] text-dim">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
