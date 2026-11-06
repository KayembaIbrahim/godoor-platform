-- Fare observations: estimated-vs-actual distance logging for rate tuning (v2)
-- Populated by the server on completion; never read for billing.
-- After ~4 weeks of Kampala data, re-tune per-km rates from evidence.
CREATE TABLE IF NOT EXISTS public.fare_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID REFERENCES public.ride_requests(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'ride',
  tier TEXT,
  estimated_km NUMERIC(8,2) NOT NULL DEFAULT 0,
  actual_km NUMERIC(8,2) NOT NULL DEFAULT 0,
  estimated_min NUMERIC(8,1) NOT NULL DEFAULT 0,
  actual_min NUMERIC(8,1) NOT NULL DEFAULT 0,
  quoted_total INTEGER NOT NULL DEFAULT 0,
  charged_total INTEGER NOT NULL DEFAULT 0,
  at_minimum BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.fare_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fare_observations FROM anon;
GRANT ALL ON public.fare_observations TO service_role;
CREATE INDEX IF NOT EXISTS idx_fare_obs_tier_created ON public.fare_observations (tier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fare_obs_ride ON public.fare_observations (ride_id);
