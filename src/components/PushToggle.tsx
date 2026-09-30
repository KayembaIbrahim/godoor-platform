"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Check } from "lucide-react";
import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  registerPushWorker,
} from "@/lib/web-push-client";

/**
 * Opt-in control for browser push.
 *
 * Hides itself entirely where push cannot work — notably the Capacitor APK's
 * Android WebView, which has no Push API — rather than showing a button that
 * silently does nothing. A permission the user declines is remembered, and we
 * stop prompting.
 */
export default function PushToggle({ className = "" }: { className?: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [state, setState] = useState<"unknown" | "on" | "off" | "denied">("unknown");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok = isPushSupported();
    setSupported(ok);
    if (!ok) return;
    registerPushWorker();
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  if (supported === null) return null;
  if (!supported) return null;

  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    if (state === "on") {
      await unsubscribeFromPush();
      setState("off");
      setMsg("Notifications turned off on this device.");
    } else {
      const r = await subscribeToPush();
      if (r.ok) {
        setState("on");
        setMsg("You will be notified when your order or ride moves.");
      } else {
        setState(r.error.includes("not granted") ? "denied" : "off");
        setMsg(r.error);
      }
    }
    setBusy(false);
  };

  const on = state === "on";

  return (
    <div className={`rounded-2xl border border-border bg-surface p-3.5 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-go/15">
          {on ? <Bell className="h-4 w-4 text-go" /> : <BellOff className="h-4 w-4 text-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Delivery notifications</p>
          <p className="truncate text-[11px] text-muted">
            {state === "denied"
              ? "Blocked in your browser settings"
              : on
                ? "On for this device"
                : "Get told when your order or ride moves"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy || state === "denied"}
          aria-pressed={on}
          className={`shrink-0 rounded-lg px-3 py-2 text-[11px] font-bold transition disabled:opacity-60 ${
            on ? "border border-border bg-bg text-muted" : "bg-go text-white hover:opacity-90"
          }`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : on ? (
            "Off"
          ) : (
            "Turn on"
          )}
        </button>
      </div>
      {msg && (
        <p className="mt-2 flex items-start gap-1.5 text-[10px] text-muted">
          {on && <Check className="mt-px h-3 w-3 shrink-0 text-success" />}
          {msg}
        </p>
      )}
    </div>
  );
}
