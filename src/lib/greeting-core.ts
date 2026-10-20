/**
 * The personalised greeting that greets every signed-in user on their own
 * home screen — customers, riders and business owners alike.
 *
 * ── Why a shared module ────────────────────────────────────────────────────
 * Three different screens show the card, and all three must agree on two
 * things that are easy to get subtly wrong:
 *
 *   1. WHAT TIME OF DAY it is. If the customer screen says "Good morning" at
 *      6pm because it used a different hour table than the rider screen, the
 *      platform feels broken in a way nobody can quite name. One table, one
 *      place.
 *
 *   2. WHO the user is. A rider's "name" is their legal name, a business
 *      owner's "name" is their trading name, and a customer's is their display
 *      name. Each screen passes its own best source in, and this module
 *      tidies it up — including the case where the account has no name at all
 *      (a signed-in user who never completed onboarding), where showing
 *      "Good morning, undefined" would be worse than showing no name.
 *
 * ── The time table ─────────────────────────────────────────────────────────
 * These are the hours people actually mean when they say the words:
 *
 *   • 05:00–11:59  Good morning   — early risers, market traders
 *   • 12:00–16:59  Good afternoon — the working middle of the day
 *   • 17:00–21:59  Good evening   — the after-work and dinner window
 *   • 22:00–04:59  Good night     — night riders, late shifts
 *
 * The boundaries are inclusive at the start and exclusive at the end, so
 * 11:59 is morning and 12:00 is afternoon — there is no gap where no
 * greeting applies.
 */

/** The four greetings, as a closed set so the UI can switch on them. */
export type GreetingKey = "morning" | "afternoon" | "evening" | "night";

/** Human-readable greeting text, e.g. "Good morning". */
export const GREETING_TEXT: Record<GreetingKey, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Good night",
};

/**
 * Which greeting applies at a given hour (0–23).
 *
 * Kept as a pure function of the hour so it can be unit-tested and so the
 * server and the client can never disagree about the hour boundaries.
 */
export function greetingForHour(hour: number): GreetingKey {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 12;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

/**
 * The greeting for right now, in the viewer's own timezone.
 *
 * The hour is read from the browser, not from the server: the whole point of
 * "good evening" is the viewer's evening. A server in UTC calling it "evening"
 * at 00:30 EAT would be wrong for the person looking at the screen.
 */
export function currentGreeting(now: Date = new Date()): GreetingKey {
  return greetingForHour(now.getHours());
}

/**
 * A short, friendly follow-on line under the greeting.
 *
 * Chosen to match the time of day rather than the role, because the card is
 * the same shape everywhere and only the name and the artwork change.
 */
export function greetingSubtext(key: GreetingKey): string {
  switch (key) {
    case "morning":
      return "Fresh day, fresh deliveries.";
    case "afternoon":
      return "Your afternoon is ready to go.";
    case "evening":
      return "Dinner and errands — we have you covered.";
    case "night":
      return "Still going? Your rider is on the way.";
  }
}

/**
 * The first name to greet the user by.
 *
 * Accepts the several sources a name can live in and returns the first one
 * that is actually usable. Returns "" when there is no name at all — callers
 * then render the greeting on its own, which reads fine:
 *
 *     Good evening
 *     Ready when you are.
 *
 * A greeting card that says "Good evening, undefined" is worse than no
 * greeting card at all, so the empty string is a supported outcome here
 * rather than something each caller has to re-check.
 */
export function resolveGreetingName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    // A full name is more than we want on a greeting line — take the first
    // word. "John Baptist Okello" becomes "John", which is how people
    // actually greet each other.
    //
    // An email address is stripped to its local part first. The email is the
    // last-resort fallback for an account with no name at all, and
    // "Good morning, john@example.com" is not a greeting — it is a support
    // ticket. "Good morning, john" is.
    const withoutDomain = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
    const first = withoutDomain.split(/\s+/)[0];
    if (first) return first;
  }
  return "";
}

/**
 * The greeting line, ready to render.
 *
 * Returns the greeting alone when there is no usable name, and
 * "<greeting>, <name>" when there is.
 */
export function greetingLine(key: GreetingKey, name: string): string {
  const base = GREETING_TEXT[key];
  return name ? `${base}, ${name}` : base;
}
