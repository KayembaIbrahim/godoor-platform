"use client";

/**
 * Make a rider actually NOTICE a new ride request.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The rider board was already live: `subscribeToOpenRides` subscribes to
 * `postgres_changes` on `ride_requests`, and that channel does deliver INSERTs
 * on the production project (verified against the real database, not assumed).
 * A 15-second poll backs it up.
 *
 * So the data was arriving and the rider still said "I can't see that there is a
 * ride request". The reason is that nothing was *loud*. The list simply grew by
 * one row while the rider was looking at the map. There was no sound, no
 * vibration, no notification and no movement on screen — so from the saddle of
 * a boda, with the phone in a pocket, a ride request is indistinguishable from
 * no ride request.
 *
 * This adds the missing half: a sound the rider can hear over traffic, a
 * vibration they feel, a system notification when the app is backgrounded, and
 * a full-screen card when it is in front of them.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type AlertItem = { id: string; at: number };

/* ── Sound ──────────────────────────────────────────────────────────────────── */

/**
 * A short three-note chime, synthesised rather than loaded.
 *
 * A rider may be on a metered 3G connection in an area with poor signal; an
 * alert that has to download an MP3 before it fires is an alert that does not
 * fire. The Web Audio oscillator is local, instant and offline.
 */
function chime(volume = 0.5): void {
  try {
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    /* iOS starts contexts suspended until a user gesture. */
    void ctx.resume?.();
    const notes = [880, 1174.66, 1567.98];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
    /* Release the hardware after the chime rather than leaving it open. */
    window.setTimeout(() => void ctx.close?.(), 900);
  } catch {
    /* Autoplay policy, no AudioContext, or a locked device — the vibration and
       the on-screen card still fire. Never let an alert throw. */
  }
}

/* ── Vibration ──────────────────────────────────────────────────────────────── */

function buzz(pattern: number[] = [220, 90, 220, 90, 320]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Unsupported or blocked — sound and the card still fire. */
  }
}

/* ── Hook ───────────────────────────────────────────────────────────────────── */

/**
 * Watch a list of rides and fire when a genuinely NEW one arrives.
 *
 * The first render establishes a baseline and stays silent, otherwise mounting
 * the panel would blare the alert for every request already on the board.
 * `enabled` lets a rider mute it once they are on a trip.
 */
export function useRideAlert<T extends { id: string }>(items: T[], enabled: boolean) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<AlertItem[]>([]);
  const dismiss = useCallback((id: string) => {
    setFresh((cur) => cur.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    const ids = items.map((r) => r.id);

    /* First sighting: adopt everything as known, silently. */
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }

    const added = ids.filter((id) => !seen.current!.has(id));
    if (added.length === 0) return;
    for (const id of added) seen.current!.add(id);
    /* Ids that disappeared left the board (taken or cancelled). Forget them so a
       later reappearance with the same id still counts as new. */
    for (const id of [...seen.current]) if (!ids.includes(id)) seen.current!.delete(id);

    if (!enabled) return;

    setFresh((cur) => [...added.map((id) => ({ id, at: Date.now() })), ...cur].slice(0, 5));
    chime();
    buzz();
    /* Repeat so it is noticed over a generator, not just once. */
    window.setTimeout(buzz, 1400);
    window.setTimeout(() => { chime(0.35); buzz(); }, 3400);

    /* Backgrounded: the OS notification is the only thing that will surface. */
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        void new Notification("New ride request", {
          body: `${added.length} passenger ${added.length === 1 ? "is" : "are"} waiting nearby`,
          tag: "godoor-ride-request",
          requireInteraction: true,
        });
      }
    } catch {
      /* Notification constructor blocked — in-app alert still shows. */
    }
  }, [items, enabled]);

  return { fresh, dismiss };
}

/**
 * Ask once for notification permission.
 *
 * Deliberately NOT fired on mount: browsers treat an unprompted request as
 * intrusive, and iOS rejects it outside a user gesture anyway. The rider taps
 * the bell deliberately.
 */
export async function requestRideNotifications(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}
