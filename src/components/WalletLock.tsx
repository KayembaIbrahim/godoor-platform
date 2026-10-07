"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Delete,
  Fingerprint,
  Loader2,
  ScanFace,
  ShieldCheck,
  X,
} from "lucide-react";

/**
 * Wallet unlock sheet — PIN pad plus fingerprint / face.
 *
 * ── What this component deliberately does not do ────────────────────────────
 * It never decides whether a PIN or a fingerprint is correct. The PIN is hashed
 * and compared on the server and WebAuthn signatures are verified there, so the
 * only thing this file does is turn taps into base64url payloads and hand the
 * minted grant back through `onAuthorized`. Anything that would make the
 * browser's opinion authoritative is left out on purpose.
 *
 * ── Enrolment vs assertion ────────────────────────────────────────────────
 * The client does not guess. `POST { action: 'bio_challenge' }` inspects the
 * stored row and answers with `registerOptions` (no credential yet — enrolment,
 * carrying `rp` / `user` / `pubKeyCredParams` / `authenticatorSelection`) or
 * `assertOptions` (a credential exists — assertion, carrying only `challenge`,
 * `timeout` and `userVerification`). `looksLikeRegister()` sniffs the shape of
 * what actually came back and `runBiometric` branches on it: register-shaped
 * means `navigator.credentials.create` + `bio_enrol`, anything else means
 * `navigator.credentials.get` + `grant_bio`. That is more reliable than any
 * client-side guess about what this device holds, and it degrades safely — a
 * shape the server does not send is treated as an assertion, which is the
 * read-only path. `isUserVerifyingPlatformAuthenticatorAvailable()` is used only
 * to decide whether to *render* the button at all.
 *
 * Enrolment and assertion both consume the stored challenge, so asserting after
 * an enrolment asks for a second, fresh challenge.
 */

export interface WalletLockProps {
  mode: "unlock" | "setup" | "setup_pin";
  open: boolean;
  onCancel: () => void;
  onAuthorized: (grant: string) => void;
  /** e.g. "Pay UGX 25,000" — shown so the user knows what they are authorising. */
  reason?: string;
}

const API = "/api/wallet/security";
const MIN_PIN = 4;
const MAX_PIN = 6;
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/* ── base64url ─────────────────────────────────────────────────────────────── */

/** Browser → server. The server's `unb64url` expects base64url, unpadded. */
function b64urlEncode(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Server → browser. `challenge` and `user.id` travel as base64url strings. */
function b64urlDecode(value: string): Uint8Array {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── API plumbing ──────────────────────────────────────────────────────────── */

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* ── WebAuthn option shapes (the server owns these) ────────────────────────── */

interface RawChallenge {
  challenge?: unknown;
  rp?: { name?: string; id?: string };
  user?: { id?: unknown; name?: string; displayName?: string };
  pubKeyCredParams?: { type: string; alg: number }[];
  timeout?: number;
  attestation?: string;
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
  };
  userVerification?: string;
}

interface ApiResult {
  ok?: boolean;
  grant?: string;
  challenge?: string;
  options?: RawChallenge;
}

/** Registration options carry an RP and a user handle; assertion options do not. */
function looksLikeRegister(options: unknown): boolean {
  if (!options || typeof options !== "object") return false;
  const o = options as Record<string, unknown>;
  return typeof o.user === "object" || typeof o.pubKeyCredParams === "object" || typeof o.rp === "object";
}

function toCreateOptions(raw: RawChallenge): PublicKeyCredentialCreationOptions {
  const user = raw.user || {};
  return {
    challenge: b64urlDecode(String(raw.challenge || "")) as BufferSource,
    rp: { name: raw.rp?.name || "GoDoor", ...(raw.rp?.id ? { id: raw.rp.id } : {}) },
    user: {
      id: b64urlDecode(String(user.id || "")) as BufferSource,
      name: user.name || "GoDoor customer",
      displayName: user.displayName || user.name || "GoDoor customer",
    },
    pubKeyCredParams: (raw.pubKeyCredParams || [{ type: "public-key", alg: -7 }]).map((p) => ({
      type: p.type as PublicKeyCredentialType,
      alg: p.alg,
    })),
    timeout: raw.timeout ?? 60_000,
    attestation: (raw.attestation || "none") as AttestationConveyancePreference,
    authenticatorSelection: {
      authenticatorAttachment: raw.authenticatorSelection
        ?.authenticatorAttachment as AuthenticatorAttachment | undefined,
      residentKey: raw.authenticatorSelection?.residentKey as ResidentKeyRequirement | undefined,
      requireResidentKey: raw.authenticatorSelection?.requireResidentKey,
      userVerification: (raw.authenticatorSelection?.userVerification ||
        "required") as UserVerificationRequirement,
    },
  };
}

function toGetOptions(raw: RawChallenge): PublicKeyCredentialRequestOptions {
  return {
    challenge: b64urlDecode(String(raw.challenge || "")) as BufferSource,
    timeout: raw.timeout ?? 60_000,
    userVerification: (raw.userVerification || "required") as UserVerificationRequirement,
  };
}

/** `navigator.credentials.create()` result → the five fields the API reads. */
function encodeAttestation(cred: PublicKeyCredential): Record<string, string> {
  const response = cred.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey?.();
  if (!publicKey) throw new Error("This device could not provide a key for fingerprint unlock");
  return {
    id: cred.id,
    rawId: b64urlEncode(cred.rawId),
    type: cred.type,
    clientDataJSON: b64urlEncode(response.clientDataJSON),
    publicKey: b64urlEncode(publicKey),
  };
}

/** `navigator.credentials.get()` result → the fields `parseAssertion` validates. */
function encodeAssertion(cred: PublicKeyCredential): Record<string, unknown> {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: b64urlEncode(cred.rawId),
    type: cred.type,
    clientDataJSON: b64urlEncode(response.clientDataJSON),
    authenticatorData: b64urlEncode(response.authenticatorData),
    signature: b64urlEncode(response.signature),
    userHandle: response.userHandle ? b64urlEncode(response.userHandle) : null,
  };
}

/** Local WebAuthn failures carry no server `error` string, so they get their own. */
function bioErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Fingerprint or face check was cancelled or timed out. Try again or use your PIN.";
    case "AbortError":
      return "The fingerprint or face check was cancelled.";
    case "InvalidStateError":
      return "This device already has a fingerprint or face unlock saved. Use your PIN instead.";
    case "SecurityError":
      return "Fingerprint or face needs a secure HTTPS connection.";
    case "NotSupportedError":
      return "This device cannot use fingerprint or face unlock.";
    case "ConstraintError":
      return "This device has no fingerprint or face sensor available.";
    default:
      return err instanceof Error && err.message
        ? err.message
        : "Fingerprint or face check failed. Try again or use your PIN.";
  }
}

/* ── component ─────────────────────────────────────────────────────────────── */

type Stage = "current" | "create" | "confirm";

export default function WalletLock({ mode, open, onCancel, onAuthorized, reason }: WalletLockProps) {
  /* PIN entry */
  const [pin, setPin] = useState("");
  const [pinLen, setPinLen] = useState<number>(MIN_PIN);
  const [stageOverride, setStageOverride] = useState<Stage | null>(null);
  const [currentPin, setCurrentPin] = useState("");

  /* Server status */
  const [hasPin, setHasPin] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  /* Capability + transient UI */
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* Lockout */
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const panelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  /* Derived */
  const locked = lockUntil !== null && lockUntil > now;
  const secondsLeft = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const blocked = locked || busy || bioBusy || !statusLoaded;
  const baseStage: Stage = mode === "unlock" ? "current" : hasPin ? "current" : "create";
  const stage: Stage = stageOverride ?? baseStage;
  /** Digits needed before this step advances. The confirm step inherits the
   *  length chosen in the create step, so a 5- or 6-digit PIN stays reachable. */
  const submitAt = pinLen;

  /* ── status ──────────────────────────────────────────────────────────────── */

  const loadStatus = useCallback(async () => {
    setStatusLoaded(false);
    try {
      const res = await fetch(API, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as ApiResult & {
        hasPin?: boolean;
        hasBiometric?: boolean;
        locked?: boolean;
        lockedUntil?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setStatusError(typeof data.error === "string" && data.error ? data.error : "Could not check wallet security");
        setStatusLoaded(true);
        return;
      }
      setStatusError(null);
      setHasPin(!!data.hasPin);
      setHasBiometric(!!data.hasBiometric);
      if (data.locked && data.lockedUntil) {
        const until = Date.parse(data.lockedUntil);
        if (Number.isFinite(until) && until > Date.now()) setLockUntil(until);
      }
    } catch {
      setStatusError("Could not reach the server. Check your connection and try again.");
      setStatusLoaded(true);
    }
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<ApiResult> => {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResult & { error?: string };
      // The 429 body carries only `error`; the exact unlock time lives on GET.
      if (res.status === 429) void loadStatus();
      if (!res.ok) {
        throw new ApiError(
          typeof data.error === "string" && data.error ? data.error : "Something went wrong. Try again.",
          res.status,
        );
      }
      return data;
    },
    [loadStatus],
  );

  /* ── reset on open ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open) return;
    setPin("");
    setPinLen(MIN_PIN);
    setStageOverride(null);
    setCurrentPin("");
    setError(null);
    setNotice(null);
    setBusy(false);
    setBioBusy(false);
    setLockUntil(null);
    inFlight.current = false;
    void loadStatus();
    const focus = setTimeout(() => panelRef.current?.focus(), 40);
    return () => clearTimeout(focus);
  }, [open, mode, loadStatus]);

  /* ── platform authenticator probe (renders / hides the bio button) ───────── */

  useEffect(() => {
    if (!open) return;
    let live = true;
    const off = (value: boolean) => {
      if (live) setBioAvailable(value);
    };
    (async () => {
      const w = window as Window & { PublicKeyCredential?: typeof PublicKeyCredential };
      if (typeof w.PublicKeyCredential === "undefined") return off(false);
      if (!navigator.credentials?.create || !navigator.credentials?.get) return off(false);
      try {
        const probe = w.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
        const available = typeof probe === "function" ? await probe.call(w.PublicKeyCredential) : false;
        off(available === true);
      } catch {
        off(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  /* ── lockout countdown ───────────────────────────────────────────────────── */

  useEffect(() => {
    if (lockUntil === null) return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [lockUntil]);

  useEffect(() => {
    if (lockUntil !== null && lockUntil <= now) {
      setLockUntil(null);
      setNotice(null);
    }
  }, [lockUntil, now]);

  /* ── escape cancels (captured while the sheet is open) ───────────────────── */

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy || bioBusy) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, busy, bioBusy, onCancel]);

  /* ── PIN submission ──────────────────────────────────────────────────────── */

  const runPin = useCallback(
    async (value: string, at: Stage) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const out =
          mode === "unlock"
            ? await post({ action: "grant_pin", pin: value })
            : await post({
                action: "set_pin",
                pin: value,
                ...(currentPin ? { currentPin } : {}),
              });
        if (out.grant) onAuthorized(out.grant);
        else setError("The server did not return an authorisation. Try again.");
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
        setError(message);
        setPin("");
        if (mode === "unlock") {
          if (status === 429) return; // the refreshed countdown takes over
          // The length is left exactly as the user had it — re-arming at 6 after
          // every slip would strand the many people whose PIN really is 4 digits.
          // The "longer than N digits" link below the pad is always visible, so
          // a 5- or 6-digit PIN has a way in without guessing at retry time.
          setNotice("That PIN did not match. If yours is longer, use the link below.");
          return;
        }
        if (at === "confirm") {
          if (/current pin/i.test(message)) {
            setCurrentPin("");
            setStageOverride("current");
          } else {
            setStageOverride("create");
          }
          setPinLen(MIN_PIN);
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [mode, currentPin, post, onAuthorized],
  );

  /* Auto-advance through the steps, auto-submit once the length is reached. */
  useEffect(() => {
    if (blocked || pin.length < submitAt) return;
    if (mode !== "unlock" && stage === "create") {
      setPinLen(pin.length); // the confirm step inherits the chosen length
      setStageOverride("confirm");
      setPin("");
      return;
    }
    if (mode !== "unlock" && stage === "current") {
      setCurrentPin(pin);
      setStageOverride("create");
      setPin("");
      return;
    }
    void runPin(pin, stage);
  }, [pin, submitAt, stage, mode, blocked, runPin]);

  const press = (d: string) => {
    if (blocked || pin.length >= MAX_PIN) return;
    setError(null);
    setNotice(null);
    setPin((p) => p + d);
  };

  const back = () => {
    if (blocked) return;
    setPin((p) => p.slice(0, -1));
  };

  /* ── biometric ───────────────────────────────────────────────────────────── */

  const runBiometric = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBioBusy(true);
    setError(null);
    setNotice(null);
    try {
      const w = window as Window & { PublicKeyCredential?: typeof PublicKeyCredential };
      if (typeof w.PublicKeyCredential === "undefined" || !navigator.credentials) {
        throw new Error("This device cannot use fingerprint or face unlock.");
      }

      /* The server picks the shape: register → enrol, otherwise → assert. */
      const first = await post({ action: "bio_challenge", name: "GoDoor customer" });
      const raw = first.options || {};

      if (looksLikeRegister(raw)) {
        const credential = await navigator.credentials.create({ publicKey: toCreateOptions(raw) });
        if (!credential) throw new Error("Fingerprint or face setup was cancelled.");
        await post({
          action: "bio_enrol",
          credential: encodeAttestation(credential as PublicKeyCredential),
        });
        setHasBiometric(true);
      }

      /* `bio_enrol` consumes the stored challenge, so the assertion needs a new
       * one — and if the server still answers register-shaped, it never enrolled. */
      const second = await post({ action: "bio_challenge", name: "GoDoor customer" });
      const assertRaw = second.options || {};
      if (looksLikeRegister(assertRaw)) {
        throw new Error("Fingerprint unlock could not be enabled. Use your PIN instead.");
      }

      const credential = await navigator.credentials.get({ publicKey: toGetOptions(assertRaw) });
      if (!credential) throw new Error("Fingerprint or face check was cancelled.");
      const out = await post({
        action: "grant_bio",
        credential: encodeAssertion(credential as PublicKeyCredential),
      });
      if (out.grant) onAuthorized(out.grant);
      else setError("The server did not return an authorisation. Try again.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : bioErrorMessage(err));
    } finally {
      inFlight.current = false;
      setBioBusy(false);
    }
  }, [post, onAuthorized]);

  if (!open) return null;

  /* ── copy ────────────────────────────────────────────────────────────────── */

  const changing = mode !== "unlock";
  const heading =
    !changing ? "Enter your wallet PIN"
    : stage === "confirm" ? "Confirm your new PIN"
    : stage === "current" ? "Enter your current PIN"
    : "Create a wallet PIN";

  const subcopy =
    !changing ? "Your PIN authorises this payment for the next 90 seconds."
    : stage === "confirm" ? "Type the same PIN again so we know it stuck."
    : stage === "current" ? "Changing your PIN needs the one you use now."
    : "Pick 4–6 digits. Avoid birthdays and repeated numbers.";

  const showBio =
    bioAvailable === true && !statusError && (mode === "setup" || (mode === "unlock" && hasBiometric));

  const bioLabel = bioBusy ? "Waiting for your device…" : hasBiometric ? "Use fingerprint / face" : "Set up fingerprint / face instead";

  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const keyClass =
    "flex h-16 items-center justify-center rounded-2xl border border-border bg-surface text-xl font-semibold text-fg transition hover:bg-elevated active:scale-[0.97] disabled:opacity-40";

  const padVisible =
    statusLoaded && !statusError && !locked && (mode === "unlock" ? hasPin : true);

  /* ── render ──────────────────────────────────────────────────────────────── */

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        onClick={busy || bioBusy ? undefined : onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-lock-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy && !bioBusy) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="relative z-10 flex max-h-[100dvh] w-full flex-col overflow-y-auto rounded-t-3xl border border-border bg-bg pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl outline-none animate-scale-in sm:max-w-sm sm:rounded-3xl"
      >
        {/* grab handle — reads as a sheet on phones, hidden when centred */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" />

        <div className="flex shrink-0 items-start gap-3 px-5 pb-1 pt-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="wallet-lock-title" className="font-display text-base font-bold leading-tight">
              {heading}
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">{subcopy}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy || bioBusy}
            aria-label="Cancel"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-muted transition hover:bg-elevated hover:text-fg disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {reason ? (
          <div className="shrink-0 px-5 pt-3">
            <span className="chip w-full justify-center border-border bg-surface text-[11px] text-fg">
              {reason.trim()}
            </span>
          </div>
        ) : null}

        <div className="shrink-0 px-5 pt-4">
          {!statusLoaded && !statusError && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your wallet…
            </div>
          )}

          {statusError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 py-3 text-xs text-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{statusError}</span>
            </div>
          )}

          {mode === "unlock" && statusLoaded && !statusError && !hasPin && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 py-3 text-xs text-danger"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>No wallet PIN is set on this account yet. Set one up before spending.</span>
            </div>
          )}

          {locked && !statusError && (
            <div role="status" aria-live="polite" className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-4 text-center">
              <p className="flex items-center justify-center gap-2 text-xs font-semibold text-danger">
                <AlertCircle className="h-4 w-4" /> Too many attempts. Try again shortly.
              </p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-danger">{countdown}</p>
            </div>
          )}

          {padVisible && (
            <>
              <div className="relative mt-5 flex min-h-[44px] items-center justify-center gap-2.5">
                <div aria-hidden className="flex items-center gap-2.5">
                  {Array.from({ length: submitAt }, (_, i) => (
                    <span
                      key={i}
                      className={`h-3.5 w-3.5 rounded-full transition ${
                        i < pin.length ? "scale-110 bg-primary" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
                {/* Real input: keeps `inputMode="numeric"` on the platform keyboard
                    and never lets the value leave the DOM as cleartext. */}
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={MAX_PIN}
                  autoComplete="one-time-code"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={pin}
                  disabled={blocked}
                  aria-label={`Wallet PIN, ${pin.length} of ${submitAt} digits entered`}
                  onChange={(e) => {
                    setError(null);
                    setNotice(null);
                    setPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN));
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer rounded-2xl text-base opacity-0 disabled:cursor-not-allowed"
                />
              </div>

              <p className="mt-2 text-center text-[11px] text-muted" aria-live="polite">
                {busy ? "Checking…" : `Enter your ${submitAt}-digit PIN`}
              </p>

              {stage === "confirm" && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setPin("");
                    setPinLen(MIN_PIN);
                    setStageOverride("create");
                  }}
                  className="mx-auto mt-1.5 block text-[11px] font-medium text-muted underline underline-offset-2 transition hover:text-fg"
                >
                  Start over
                </button>
              )}

              {notice && <p className="mt-2 text-center text-[11px] text-danger">{notice}</p>}

              {error && (
                <p
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2.5 text-[11px] text-danger"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}

              <div className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-2.5">
                {DIGITS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={keyClass}
                    disabled={blocked}
                    aria-label={`Digit ${d}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => press(d)}
                  >
                    {d}
                  </button>
                ))}

                <span aria-hidden />

                <button
                  type="button"
                  className={keyClass}
                  disabled={blocked}
                  aria-label="Digit 0"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => press("0")}
                >
                  0
                </button>

                <button
                  type="button"
                  className={`${keyClass} text-muted`}
                  disabled={blocked || pin.length === 0}
                  aria-label="Delete last digit"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={back}
                >
                  <Delete className="h-6 w-6" />
                </button>
              </div>

              {/* The length stays adjustable except while confirming, where the
                  chosen length is already fixed by the create step. */}
              {stage !== "confirm" && (
                <div className="mt-3 text-center">
                  {submitAt === MIN_PIN ? (
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => setPinLen(MAX_PIN)}
                      className="text-[11px] font-medium text-muted underline underline-offset-2 transition hover:text-fg disabled:opacity-40"
                    >
                      My PIN is longer than {MIN_PIN} digits
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => setPinLen(MIN_PIN)}
                      className="text-[11px] font-medium text-muted underline underline-offset-2 transition hover:text-fg disabled:opacity-40"
                    >
                      Use a {MIN_PIN}-digit PIN instead
                    </button>
                  )}
                </div>
              )}

              {showBio && (
                <button
                  type="button"
                  disabled={blocked}
                  onClick={runBiometric}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 py-3 text-sm font-semibold text-primary transition hover:bg-primary/15 disabled:opacity-50"
                >
                  {bioBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasBiometric ? (
                    <Fingerprint className="h-4 w-4" />
                  ) : (
                    <ScanFace className="h-4 w-4" />
                  )}
                  {bioLabel}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
