"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { Bell, Store, AlertTriangle, ShieldCheck, Package, Users, X } from "lucide-react";

type AdminNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: number;
};

const TYPE_ICONS: Record<string, typeof Bell> = {
  merchant_pending: Store,
  dispute: AlertTriangle,
  verification: ShieldCheck,
  order: Package,
  new_user: Users,
};

const TYPE_COLORS: Record<string, string> = {
  merchant_pending: "text-go",
  dispute: "text-danger",
  verification: "text-primary",
  order: "text-warning",
  new_user: "text-success",
};

function timeAgo(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function AdminNotificationBell() {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const fetchNotifications = () => {
      fetch("/api/admin/notifications", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && d?.items) {
            setItems(d.items);
            try {
              const stored = sessionStorage.getItem("gd_admin_notif_seen");
              if (stored) setSeen(new Set(JSON.parse(stored)));
            } catch {}
          }
        })
        .catch(() => {});
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unread = items.filter((n) => !seen.has(n.id)).length;

  const markAllRead = () => {
    const newSeen = new Set(items.map((n) => n.id));
    setSeen(newSeen);
    try { sessionStorage.setItem("gd_admin_notif_seen", JSON.stringify([...newSeen])); } catch {}
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open && unread > 0) markAllRead(); }}
        className="relative rounded-full p-2 text-muted hover:bg-elevated hover:text-fg transition"
        aria-label="Admin notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-danger text-[8px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            {/* Centered rather than anchored to the bell. A right-anchored
                dropdown runs to the screen edge on a narrow phone and gets
                clipped; a centered panel cannot overflow horizontally, and the
                capped height keeps it inside the viewport. */}
            <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-4 pt-20">
              <div className="pointer-events-auto max-h-[70vh] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl animate-scale-in">
                <div className="flex items-center justify-between border-b border-border px-3 pb-2">
                  <p className="text-xs font-semibold">Notifications</p>
                  {items.length > 0 && (
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="rounded-lg bg-go/10 px-2.5 py-1 text-[10px] font-semibold text-go transition hover:bg-go/20"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                {items.length === 0 ? (
                  <div className="py-6 text-center">
                    <Bell className="mx-auto h-6 w-6 text-dim" />
                    <p className="mt-1.5 text-[11px] text-muted">No notifications</p>
                  </div>
                ) : (
                  <div className="mt-1 max-h-[55vh] space-y-0.5 overflow-y-auto">
                    {items.slice(0, 25).map((n) => {
                      const Icon = TYPE_ICONS[n.type] || Bell;
                      const col = TYPE_COLORS[n.type] || "text-muted";
                      const isUnread = !seen.has(n.id);
                      return (
                        <Link
                          key={n.id}
                          href={n.href}
                          onClick={() => setOpen(false)}
                          className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition hover:bg-elevated ${isUnread ? "bg-go/5" : ""}`}
                        >
                          <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-go/10 ${col}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium">{n.title}</p>
                            <p className="text-[10px] leading-snug text-muted">{n.body}</p>
                            <p className="mt-0.5 text-[9px] text-dim">{timeAgo(n.createdAt)}</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
