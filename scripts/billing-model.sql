-- Billing model v2: flat service fees + 1,500/km + GoMart runner fee
-- Idempotent — safe to re-run.

ALTER TABLE public.fare_rates
  ADD COLUMN IF NOT EXISTS boda_per_km_ugx INTEGER NOT NULL DEFAULT 1500;

UPDATE public.fare_rates SET boda_per_km_ugx = 1500 WHERE id = 'default' AND boda_per_km_ugx = 1200;

-- Rider-settable per-km rate for GoMart / delivery billing
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS rate_per_km_ugx INTEGER NOT NULL DEFAULT 1500;

-- Backfill: existing riders get the default 1,500/km
UPDATE public.riders SET rate_per_km_ugx = 1500 WHERE rate_per_km_ugx IS NULL;

-- Ensure fee_config exists with flat-fee semantics baked in via app defaults.
-- (service_fee_percent is retained for legacy rows; the engine now uses flat fees.)
