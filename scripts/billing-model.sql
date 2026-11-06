-- Billing model v3: banded boda per-km rates (day/evening/late) + flat service fees
-- Operator schedule (EAT):
--   day      00:00-21:00 → 1,000/km
--   evening  21:00-00:00 → 1,500/km
--   late     00:00-06:30 → 2,000/km
-- Idempotent — safe to re-run.

ALTER TABLE public.fare_rates
  ADD COLUMN IF NOT EXISTS boda_per_km_ugx INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS boda_evening_per_km_ugx INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS boda_late_per_km_ugx INTEGER NOT NULL DEFAULT 2000;

-- Tier boundaries: evening starts 21:00 (9pm), late starts midnight (0:00), ends 06:30.
ALTER TABLE public.fare_rates
  ADD COLUMN IF NOT EXISTS evening_start_hour NUMERIC(4,2) NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS late_start_hour NUMERIC(4,2) NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS late_end_hour NUMERIC(4,2) NOT NULL DEFAULT 6.5;

-- Align live rows to the published schedule (no longer 1,500 flat on day).
UPDATE public.fare_rates SET boda_per_km_ugx = 1000 WHERE id = 'default' AND boda_per_km_ugx IN (1200, 1500);
UPDATE public.fare_rates SET boda_evening_per_km_ugx = 1500 WHERE id = 'default' AND boda_evening_per_km_ugx IS NULL;
UPDATE public.fare_rates SET boda_late_per_km_ugx = 2000 WHERE id = 'default' AND boda_late_per_km_ugx IS NULL;
UPDATE public.fare_rates SET evening_start_hour = 21 WHERE id = 'default' AND evening_start_hour IN (19.5, 19);
UPDATE public.fare_rates SET late_start_hour = 24 WHERE id = 'default' AND late_start_hour IN (22, 23);
UPDATE public.fare_rates SET late_end_hour = 6.5 WHERE id = 'default' AND late_end_hour IS NULL;

-- Rider-settable per-km rate for GoMart / delivery billing
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS rate_per_km_ugx INTEGER NOT NULL DEFAULT 1500;

-- Backfill: existing riders get the default 1,500/km
UPDATE public.riders SET rate_per_km_ugx = 1500 WHERE rate_per_km_ugx IS NULL;

-- Ensure fee_config exists with flat-fee semantics baked in via app defaults.
-- (service_fee_percent is retained for legacy rows; the engine now uses flat fees.)
