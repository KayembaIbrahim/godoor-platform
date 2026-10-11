/**
 * GoDoor store opening hours — merchant open days of week + daily hours.
 *
 * The merchants table stores:
 *   - open_days TEXT   comma list, e.g. "Mon,Tue,Wed" (defaults to all 7)
 *   - opens_at TEXT    HH:MM on open days
 *   - closes_at TEXT   HH:MM on open days
 *
 * This module makes those machine-checkable and UI-friendly. Pure logic, no I/O.
 */

export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Day = (typeof DAY_ORDER)[number];

export type OpeningMerchant = {
  opens_at?: string | null;
  closes_at?: string | null;
  open_days?: string | null;
};

export const ALL_DAYS = DAY_ORDER.join(",");

/** Parse a merchant's open-day list into a Set, defaulting to all seven. */
export function openDaysSet(merchant: OpeningMerchant): Set<Day> {
  const raw = merchant.open_days || ALL_DAYS;
  const days = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Day[];
  if (days.length === 0) return new Set(DAY_ORDER);
  return new Set(days);
}

/** Whether the merchant is open right now (weekday + hours), with the old default behaviour
    preserved: a merchant whose open days have never been customised is open on every day. */
export function isOpenNow(merchant: OpeningMerchant): boolean {
  if (!merchant.opens_at || !merchant.closes_at) return true;
  const set = openDaysSet(merchant);
  const today = DAY_ORDER[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] as Day;
  if (!set.has(today)) return false;
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return current >= merchant.opens_at && current <= merchant.closes_at;
}

/** A compact label for the day range, shown alongside hours. */
export function openDaysLabel(merchant: OpeningMerchant): string {
  const set = openDaysSet(merchant);
  const hasFull = set.size === 7 && DAY_ORDER.every((d) => set.has(d as Day));
  if (hasFull) return "Mon–Sun";

  const arr = [...set] as Day[];
  // Detect ranges (Mon..Fri) or short lists (Mon, Wed, Fri).
  const ranges: string[] = [];
  let start = arr[0];
  let prev = arr[0];
  for (const d of arr.slice(1)) {
    const startIdx = DAY_ORDER.indexOf(start);
    const idx = DAY_ORDER.indexOf(d);
    if (idx === DAY_ORDER.indexOf(prev) + 1) {
      prev = d;
    } else {
      ranges.push(start === prev ? start : `${start}–${prev}`);
      start = d;
      prev = d;
    }
  }
  ranges.push(start === prev ? start : `${start}–${prev}`);
  return ranges.join(", ");
}

/** A label for a single merchant's full hours text, e.g. "08:00–22:00 · Mon–Fri". */
export function openHoursLabel(merchant: OpeningMerchant): string {
  return `${merchant.opens_at || "--:--"}–${merchant.closes_at || "--:--"} · ${openDaysLabel(merchant)}`;
}
