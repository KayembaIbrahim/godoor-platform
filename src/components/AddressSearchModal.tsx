"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, MapPin, Navigation, X, Loader2, Crosshair } from "lucide-react";
import { fetchPlaceSuggestions, type LatLng } from "@/lib/location";

type AddressResult = { place: string; lat: number; lng: number };

/**
 * Where a saved address came from.
 *
 * This distinction is the whole fix for "the welcome page finds my location but
 * the app doesn't". Both surfaces persist into one localStorage key, and the
 * home screen gave that stored value absolute priority over the live fix from
 * `useGeolocation`. So whichever address landed in the key first — an IP-level
 * city estimate from a previous session, or a place picked on last week's WiFi
 * — was frozen there forever: `rememberDetectedAddress` refused to overwrite an
 * existing entry, and nothing else ever wrote it. The header then showed that
 * stale place while a perfectly good live GPS fix sat unused in the hook, and
 * re-picking it by hand was the only way out. That is the reported symptom.
 *
 * `manual` = the customer deliberately chose this, so it must always win.
 * `auto`   = the app worked it out; it is a cache hint, and a real fix may
 *            replace it (which is also how an IP estimate gets upgraded to a
 *            street address the moment GPS lands).
 */
export type AddressSource = "manual" | "auto";

export type StoredAddress = AddressResult & { source?: AddressSource };

const STORAGE_KEY = "godoor-delivery-address";

/** Get last-used delivery address from localStorage */
export function getLastAddress(): StoredAddress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

/** Save delivery address to localStorage. Customer-initiated picks are `manual`. */
function saveLastAddress(addr: AddressResult, source: AddressSource = "manual") {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...addr, source })); } catch {}
}

/**
 * Persist a location the app detected for itself, so it carries across surfaces.
 *
 * The welcome page auto-detects the visitor's area and displays it, but never
 * saved it — `saveLastAddress` was module-private and reachable only from
 * inside the address modal. So a customer who watched the hero resolve
 * "Kampala" landed on the signed-in home showing "Set your delivery address"
 * and had to re-pick what the app had just worked out for them. Detection now
 * survives the sign-in, on both surfaces, in the same order.
 *
 * An address the customer picked deliberately always wins and is never
 * overwritten. An address the app detected is only a hint, and is refreshed
 * whenever a better reading lands — otherwise the first value ever written is
 * the last value ever read, which is what pinned customers to a stale place.
 */
export function rememberDetectedAddress(
  place: string | null | undefined,
  coords: { lat: number; lng: number } | null | undefined,
): void {
  if (typeof window === "undefined") return;
  if (!place || !coords) return;
  try {
    const existing = getLastAddress();
    /* A deliberate choice is untouchable — always. An auto entry is not: it is
       only a hint, and this is where a city-level IP estimate gets upgraded to
       the real street once GPS lands. The old code returned early on ANY
       existing entry, so the very first value ever written was the last value
       ever read, on both surfaces, for the life of the install. */
    if (existing?.source === "manual") return;
    saveLastAddress({ place, lat: coords.lat, lng: coords.lng }, "auto");
  } catch {}
}

export function AddressSearchModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (result: AddressResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const r = await fetchPlaceSuggestions(q);
      setResults(r);
      setLoading(false);
    }, 300);
  }, []);

  const handleSelect = useCallback((r: AddressResult) => {
    saveLastAddress(r);
    onSelect(r);
    onClose();
  }, [onSelect, onClose]);

  const useCurrentLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      alert("GPS not available on this device");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Reverse geocode to get address string
        try {
          const { reverseGeocode } = await import("@/lib/location");
          const addr = await reverseGeocode({ lat, lng });
          const result = { place: addr, lat, lng };
          saveLastAddress(result);
          onSelect(result);
          onClose();
        } catch {
          const result = { place: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`, lat, lng };
          saveLastAddress(result);
          onSelect(result);
          onClose();
        }
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
        alert("Could not get your location. Please type your address instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [onSelect, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-start justify-center pt-[10vh]" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl bg-bg shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <MapPin className="h-5 w-5 text-go shrink-0" />
          <h2 className="font-display text-base font-semibold flex-1">Set delivery address</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-surface text-muted hover:bg-elevated transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
              placeholder="Search area, street, or landmark…"
              className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-10 text-sm outline-none ring-go focus:ring-2"
            />
            {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-go" />}
            {!loading && query && (
              <button type="button" onClick={() => { setQuery(""); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* GPS button */}
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={gpsLoading}
            className="flex w-full items-center gap-3 rounded-xl border border-go/30 bg-go/5 px-4 py-3 transition hover:bg-go/10 disabled:opacity-50"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-go/15">
              {gpsLoading ? (
                <Loader2 className="h-4 w-4 text-go animate-spin" />
              ) : (
                <Crosshair className="h-4 w-4 text-go" />
              )}
            </span>
            <div className="text-left">
              <p className="text-sm font-medium text-go">{gpsLoading ? "Getting your location…" : "Use current location"}</p>
              <p className="text-[10px] text-muted">GPS will find your exact position</p>
            </div>
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto border-t border-border px-2 py-2">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(r)}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-elevated"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-go" />
                <span className="text-sm text-fg leading-snug">{r.place}</span>
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && query && results.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted">No results for &ldquo;{query}&rdquo;</p>
            <p className="mt-1 text-xs text-dim">Try a different search or use your current location</p>
          </div>
        )}

        {/* Hint */}
        {!query && results.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-dim">Type your area, street, or landmark to find nearby shops</p>
          </div>
        )}
      </div>
    </div>
  );
}
