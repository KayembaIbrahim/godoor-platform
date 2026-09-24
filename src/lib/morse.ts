export const MORSE_TAG_RE = /^[a-z0-9_]{3,32}$/;

/** Normalize a Morse handle to its unique form: strips leading @, trims, lowercases. */
export function normalizeMorseTag(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}