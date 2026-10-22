"use client";

import { useRef, useState } from "react";

/**
 * Voice navigation system for GODOOR riders.
 *
 * Uses the browser's Web Speech API (SpeechSynthesis) to speak turn-by-turn
 * directions so a rider can keep eyes on the road. Works in the PWA/webview
 * and on mobile Chrome/Safari — no backend, no API key, no network after load.
 *
 * Announces the next turn instruction once when voice guidance is turned on.
 * A second tap re-announces the same instruction. Arrival is announced once
 * when the destination is reached.
 */

type AnnounceKind = "next-turn" | "arrive" | "status";

export interface VoiceNavConfig {
  /** Language hint, e.g. "en-UG" / "en-GB" / "en-US". */
  lang?: string;
  /** Speech rate 0.5–2 (default 1). */
  rate?: number;
  /** Speech volume 0–1 (default 1). */
  volume?: number;
  /** Pitch 0–2 (default 1). */
  pitch?: number;
}

/** Result of calling speak() — useful for debouncing in the UI. */
export interface VoiceNavAnnounce {
  kind: AnnounceKind;
  instruction: string;
}

/**
 * Hook that owns one SpeechSynthesis instance per component.
 * Safe to call from multiple places — only one utterance plays at a time.
 */
export function useVoiceGuidance(config: VoiceNavConfig = {}) {
  const {
    lang = "en-UG",
    rate = 1,
    volume = 1,
    pitch = 1,
  } = config;

  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const supported = Boolean(synth);
  const [state, setState] = useState<"idle" | "speaking" | "paused" | "unsupported">(
    supported ? "idle" : "unsupported",
  );
  const lastHeard = useRef<VoiceNavAnnounce | null>(null);

  const speak = (ann: VoiceNavAnnounce) => {
    if (!synth || state === "speaking") return;
    const utter = new SpeechSynthesisUtterance(ann.instruction);
    utter.rate = rate;
    utter.volume = volume;
    utter.pitch = pitch;
    utter.lang = lang;
    utter.onstart = () => setState("speaking");
    utter.onend = () => setState("idle");
    utter.onerror = () => setState("idle");
    synth.speak(utter);
    lastHeard.current = ann;
  };

  const pause = () => { if (synth && state === "speaking") synth.pause(); setState("paused"); };
  const resume = () => { if (synth && state === "paused") synth.resume(); setState("speaking"); };
  const cancel = () => { if (synth) synth.cancel(); setState("idle"); };

  const announceNextTurn = (instruction: string) => {
    speak({ kind: "next-turn", instruction });
  };

  const announceArrive = () => {
    speak({ kind: "arrive", instruction: "You have arrived at your destination." });
  };

  const announceStatus = (text: string) => {
    speak({ kind: "status", instruction: text });
  };

  return {
    supported,
    state,
    speak,
    pause,
    resume,
    cancel,
    announceNextTurn,
    announceArrive,
    announceStatus,
  };
}