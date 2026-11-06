"use client";

/**
 * The single fare-display component. Preview, map card, active-ride card and
 * receipt all render the SAME quote object through here, so "fare" vs "total"
 * confusion is structurally impossible. This component never computes money —
 * it renders lines the server returned.
 */

export type FareLines = {
  base_ugx?: number | null;
  distance_ugx?: number | null;
  time_ugx?: number | null;
  wait_ugx?: number | null;
  bulky_ugx?: number | null;
  fare_ugx?: number | null;
  service_fee_ugx?: number | null;
  total_ugx?: number | null;
  at_minimum?: boolean | null;
  tier_label?: string | null;
  distance_km?: number | null;
  per_km_ugx?: number | null;
};

const fmt = (n?: number | null) => `UGX ${Math.round(Number(n) || 0).toLocaleString("en-UG")}`;
const num = (n?: number | null) => Math.round(Number(n) || 0);

export default function FareBreakdown({ quote, compact }: { quote: FareLines; compact?: boolean }) {
  const base = num(quote.base_ugx), dist = num(quote.distance_ugx), time = num(quote.time_ugx);
  const wait = num(quote.wait_ugx), bulky = num(quote.bulky_ugx);
  const fare = num(quote.fare_ugx), fee = num(quote.service_fee_ugx), total = num(quote.total_ugx) || fare + fee;
  const km = Number(quote.distance_km) || 0;
  const perKm = num(quote.per_km_ugx);
  return (
    <div className={compact ? "rounded-xl bg-elevated/60 p-3 text-[11px]" : "rounded-2xl border border-border bg-surface p-4 text-xs"}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-dim">
        Fare breakdown{quote.tier_label ? ` · ${quote.tier_label}` : ""}
      </p>
      <div className="space-y-1.5">
        {base > 0 && <Row label="Base fare" amount={base} />}
        {(dist > 0 || km > 0) && (
          <Row label={`Distance${km > 0 ? ` · ${km.toFixed(1)} km${perKm ? ` × ${perKm.toLocaleString()}` : ""}` : ""}`} amount={dist} />
        )}
        {time > 0 && <Row label="Time" amount={time} />}
        {quote.at_minimum ? <Row label="Minimum fare applied" amount={0} note="floor lifted fare" /> : null}
        {wait > 0 && <Row label="Waiting" amount={wait} />}
        {bulky > 0 && <Row label="Bulky items" amount={bulky} />}
        <Row label="Fare (excl. service fee)" amount={fare} bold />
        {fee > 0 && <Row label={`Service fee (flat ${fee.toLocaleString()})`} amount={fee} />}
        <div className="flex justify-between border-t border-border pt-1.5 font-bold">
          <span>Total — what you pay</span>
          <span className="tabular-nums">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, amount, bold, note }: { label: string; amount: number; bold?: boolean; note?: string }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted">{label}{note ? ` — ${note}` : ""}</span>
      <span className="tabular-nums">{amount === 0 && note ? "+0" : fmt(amount)}</span>
    </div>
  );
}
