/**
 * Night earnings guarantee — riders online 23:00–07:00 EAT get a +500 UGX
 * per completed trip top-up when their trip fare falls below the guarantee.
 *
 * WHY: night supply dies without it (few riders, higher risk, longer waits).
 * It's a supply-retention lever, cheaper than raising rates for everyone.
 * EAT = UTC+3, no DST.
 */
export const NIGHT_START_HOUR = 23;
export const NIGHT_END_HOUR = 7;
export const NIGHT_GUARANTEE_UGX = 500;

export function isNightHour(iso: string | Date | null | undefined): boolean {
  if (!iso) return false;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return false;
  // Convert to EAT: UTC+3.
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const h = eat.getUTCHours();
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

/**
 * Top-up owed on a completed trip: NIGHT_GUARANTEE_UGX when the trip was
 * completed during night hours, else 0. The guarantee is a floor on the
 * rider's per-trip earnings — if their trip gross was already above it,
 * they still get the top-up (it's a bonus for night availability).
 */
export function nightGuaranteeFor(completedAt: string | Date | null | undefined): number {
  return isNightHour(completedAt) ? NIGHT_GUARANTEE_UGX : 0;
}
