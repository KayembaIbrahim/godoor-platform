"use client";

import { useCallback, useEffect, useState } from "react";
import { Volume2, VolumeX, Mic, Settings } from "lucide-react";
import { useVoiceGuidance } from "@/lib/voice-nav";

/**
 * VoiceNavigation — rider-facing voice navigation controls.
 *
 * - Speak the current next turn (TTS) through the Web Speech API.
 * - Toggle guidance on/off, adjust rate + volume.
 * - Voice command chip: "next turn", "arrive", "recalculate".
 */
type Props = {
  /** When true, the map is navigating somewhere — we own the announcements. */
  navigating: boolean;
  /** Current next-turn instruction + distance in metres. Null while loading. */
  nextTurn: { instruction: string; distanceM?: number } | null;
  /** True when the rider has arrived at the destination. */
  arrived: boolean;
  /** Called when the rider asks the system to recalculate (e.g. "recalculate"). */
  onRecalculate?: () => void;
};

export function VoiceNavigation({ navigating, nextTurn, arrived, onRecalculate }: Props) {
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [announceDistanceM, setAnnounceDistanceM] = useState(200);

  const {
    supported,
    state,
    speak,
    pause,
    resume,
    cancel,
    announceNextTurn,
    announceArrive,
  } = useVoiceGuidance({ rate, volume, pitch, announceDistanceM });

  // Announce the next turn when the rider comes within the window.
  useEffect(() => {
    if (!navigating || !nextTurn) return;
    if (arrived) {
      announceArrive();
      return;
    }
    if (nextTurn.distanceM != null && nextTurn.distanceM > announceDistanceM) return;
    if (typeof nextTurn.distanceM === "number" && nextTurn.distanceM >= 0) {
      announceNextTurn(nextTurn.instruction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTurn?.instruction, nextTurn?.distanceM, navigating, arrived, announceDistanceM]);

  // Arrival announcement (one-shot-ish).
  useEffect(() => {
    if (navigating && arrived) announceArrive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, navigating]);

  const handleRecalculate = () => {
    cancel();
    onRecalculate?.();
  };

  const toggle = () => {
    if (!supported) return;
    if (state === "speaking") {
      pause();
    } else if (state === "paused") {
      resume();
    } else {
      // Start speaking the current next turn.
      if (navigating && nextTurn) {
        speak(nextTurn.instruction);
      } else {
        speak("Voice guidance ready.");
      }
    }
  };

  const speakNow = () => {
    if (arrived) {
      announceArrive();
      return;
    }
    if (navigating && nextTurn) {
      speak(nextTurn.instruction);
      return;
    }
    speak("Voice guidance ready.");
  };

  if (!supported) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1.5 text-[11px] text-muted">
        <VolumeX className="h-3.5 w-3.5" />
        Voice not supported on this device
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1.5">
      {/* Speak-now button — reads the current instruction aloud */}
      <button
        type="button"
        onClick={speakNow}
        aria-label="Speak current navigation instruction"
        className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface/90 text-muted shadow-sm hover:bg-surface"
      >
        <Volume2 className="h-4 w-4" />
      </button>

      {/* Main toggle — pause/resume/speak */}
      <button
        type="button"
        onClick={toggle}
        aria-label={state === "speaking" ? "Pause voice guidance" : state === "paused" ? "Resume voice guidance" : "Start voice guidance"}
        className={`grid h-11 w-11 place-items-center rounded-full shadow-lg backdrop-blur-md transition ${
          state === "speaking"
            ? "bg-go text-white"
            : state === "paused"
              ? "bg-surface text-fg border border-border"
              : "bg-elevated text-fg border border-border"
        }`}
      >
        {state === "speaking" ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
      </button>

      {/* Recalculate */}
      <button
        type="button"
        onClick={handleRecalculate}
        aria-label="Recalculate route"
        className="grid h-11 w-11 place-items-center rounded-full bg-elevated text-fg border border-border shadow-sm hover:bg-surface"
      >
        <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M3 13l6-6 6 6 6-6" />
        </svg>
      </button>

      {/* Settings / controls */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Voice settings"
        className="grid h-11 w-11 place-items-center rounded-full bg-elevated text-fg border border-border"
      >
        <Settings className="h-4.5 w-4.5" />
      </button>

      {open && (
        <div className="absolute right-3 bottom-20 z-30 w-64 rounded-2xl border border-border bg-surface p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold">Voice navigation</p>
            <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg text-xs">✕</button>
          </div>
          <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-dim">Announce before turn</label>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={announceDistanceM}
            onChange={(e) => setAnnounceDistanceM(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted">
            <span>{announceDistanceM >= 400 ? `${announceDistanceM / 1000} km` : `${announceDistanceM} m`}</span>
            <span className="text-dim">{announceDistanceM < 150 ? "near" : "comfortable"}</span>
          </div>
          <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-dim">Speed</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="mt-0.5 text-[10px] text-muted"><span>{rate.toFixed(1)}×</span></div>
          <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-dim">Volume</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Lightweight voice COMMAND control. A mic button that listens and dispatches
 * recognised navigation commands. Kept small so it can sit anywhere the rider
 * needs to speak ("next turn", "arrive", "recalculate").
 */
export function VoiceCommandButton({ onCommand, disabled }: { onCommand: (cmd: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const supported = typeof window !== "undefined" && !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = () => {
    if (!supported || disabled) return;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = "en-UG";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript || "";
      if (transcript) onCommand(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  useEffect(() => () => {}, []);

  return (
    <button
      type="button"
      onClick={() => { if (listening) setListening(false); else start(); }}
      aria-label={listening ? "Stop voice command" : "Voice command"}
      className={`grid h-10 w-10 place-items-center rounded-full shadow-lg backdrop-blur-md transition ${
        !supported
          ? "bg-muted text-muted cursor-not-allowed"
          : listening
            ? "bg-danger text-white animate-pulse"
            : "bg-elevated text-fg border border-border"
      }`}
      disabled={!supported || disabled}
    >
      {listening ? <Mic className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </button>
  );
}
