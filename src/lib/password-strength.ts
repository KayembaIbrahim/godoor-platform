/**
 * Shared password strength rules for the admin portal.
 * Pure module (no node/server imports) — safe to use from both
 * server routes and client components.
 */

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRequirement {
  id: string;
  label: string;
  met: boolean;
}

const FORBIDDEN_COMMON = [
  "ss356",
  "godoor",
  "godooradmin",
  "password",
  "password1",
  "password123",
  "admin",
  "admin123",
  "administrator",
  "letmein",
  "welcome",
  "qwerty",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "000000",
  "111111",
  "abc123",
  "iloveyou",
];

export function evaluatePassword(pw: string): { requirements: PasswordRequirement[]; score: number; ok: boolean } {
  const value = pw || "";
  const requirements: PasswordRequirement[] = [
    { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: value.length >= PASSWORD_MIN_LENGTH },
    { id: "upper", label: "Uppercase letter (A-Z)", met: /[A-Z]/.test(value) },
    { id: "lower", label: "Lowercase letter (a-z)", met: /[a-z]/.test(value) },
    { id: "digit", label: "Number (0-9)", met: /\d/.test(value) },
    { id: "symbol", label: "Symbol (!@#$%)", met: /[^\w\s]/.test(value) },
  ];
  const common = FORBIDDEN_COMMON.includes(value.toLowerCase().replace(/\s/g, ""));
  const score = requirements.filter((r) => r.met).length;
  const ok = requirements.filter((r) => r.id !== "symbol").every((r) => r.met) && !common;
  return { requirements, score, ok };
}

/** Returns a ready-to-display error message for a rejected password. */
export function passwordError(pw: string): string {
  const { requirements, ok } = evaluatePassword(pw);
  const unmet = requirements.filter((r) => !r.met).map((r) => r.label);
  if (ok || pw.length === 0) return "";
  if (unmet.length === 0) return "This password is too common and easy to guess. Pick something more unique.";
  return "Password must include: " + unmet.join(", ") + ".";
}