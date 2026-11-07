"use client";

/**
 * Loud ringtone alert that reaches riders and businesses even when they are
 * away from the site — phone in pocket, tab backgrounded, app not on screen.
 *
 * A web page has three escalation layers and this module combines all of them:
 *
 *   1. Web Audio ringtone — a loud looping siren that plays as long as the tab
 *      is open (even when hidden), at full volume, audible over traffic / a
 *      generator / a shop's noise. Synthesised so it needs no network fetch.
 *   2. Vibration — the same pattern as `navigator.vibrate`, felt through a
 *      pocket even on silent mode.
 *   3. Native Notification — a persistent system notification (`requireInteraction`)
 *      that stays in the shade until tapped, so the alert survives the tab
 *      being backgrounded and the user returning later.
 *
 * Each layer is independent: if one is blocked (autoplay policy, permission
 * denied), the others still fire. Nothing here throws.
 *
 * The ringtone is SILENT-UNTIL-USER-GESTURE by browser rules, except the very
 * first creation path. Callers should have a user-gesture unlock button that
 * calls `unlockAudio()` — typical flow: a "Enable alerts" bell tap.
 */

let sharedCtx: AudioContext | null = null;
let ringInterval: number | null = null;
let ringOscillators: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
let audioUnlocked = false;

function getCtx(): AudioContext | null {
  try {
    if (sharedCtx) return sharedCtx;
    const Ctor =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

/** Call from any user tap (bell, toggle). Lets browsers trust the ringtone later. */
export function unlockAudio(): void {
  try {
    const ctx = getCtx();
    if (ctx?.state === "suspended") void ctx.resume?.();
    audioUnlocked = true;
  } catch {
    /* ignore */
  }
}

function beep(freqStart: number, freqEnd: number, startAt: number, duration: number, volume = 0.55) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freqStart, startAt);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
    ringOscillators.push({ osc, gain });
  } catch {
    /* ignore */
  }
}

/** Play one loud siren burst (up-down-up). ~1.2s. */
function sirenBurst(volume = 0.55) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    beep(740, 1480, t, 0.42, volume);
    beep(1480, 740, t + 0.42, 0.42, volume);
    beep(740, 1480, t + 0.84, 0.42, volume);
  } catch {
    /* ignore */
  }
}

function buzzRing() {
  try {
    navigator.vibrate?.([400, 100, 400, 100, 800]);
  } catch {
    /* ignore */
  }
}

/**
 * Start the loud ringtone loop. Keeps ringing until `stopLoudAlert()` is called.
 * Safe to call repeatedly — it will not stack multiple loops.
 */
export function startLoudAlert(opts?: { title?: string; body?: string; tag?: string }) {
  const title = opts?.title ?? "New GoDoor order";
  const body = opts?.body ?? "Tap to open GoDoor";
  const tag = opts?.tag ?? "godoor-loud-alert";

  // 1. Native notification (persistent until dismissed)
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void new Notification(title, {
        body,
        icon: "/brand/godoor-mark.png",
        badge: "/brand/godoor-mark.png",
        tag,
        requireInteraction: true,
        vibrate: [400, 100, 400, 100, 800],
      } as NotificationOptions);
    }
  } catch {
    /* Notification constructor blocked — ringtone still plays. */
  }

  // 2. Ringtone loop — starts immediately, repeats every ~1.6s
  if (ringInterval != null) return;
  try {
    const ctx = getCtx();
    if (ctx?.state === "suspended") void ctx.resume?.();
  } catch {
    /* ignore */
  }
  sirenBurst(0.6);
  buzzRing();
  ringInterval = window.setInterval(() => {
    sirenBurst(0.6);
    buzzRing();
  }, 1600);
}

/** Stop the ringtone loop and release audio nodes. */
export function stopLoudAlert() {
  if (ringInterval != null) {
    window.clearInterval(ringInterval);
    ringInterval = null;
  }
  try {
    for (const { osc } of ringOscillators) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
  } catch {
    /* ignore */
  }
  ringOscillators = [];
}

/**
 * One-shot alert — siren + buzz + notification, but no loop.
 * Use for order status changes and non-urgent events.
 */
export function fireAlert(opts?: { title?: string; body?: string; tag?: string }) {
  const title = opts?.title ?? "GoDoor update";
  const body = opts?.body ?? "";
  const tag = opts?.tag ?? "godoor-alert";
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void new Notification(title, {
        body,
        icon: "/brand/godoor-mark.png",
        badge: "/brand/godoor-mark.png",
        tag,
        vibrate: [200, 80, 200],
      } as NotificationOptions);
    }
  } catch {
    /* ignore */
  }
  sirenBurst(0.4);
  buzzRing();
}

/** Ask for Notification permission. Call from a user gesture. */
export async function requestLoudNotificationPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}
