-- ─────────────────────────────────────────────────────────────────
-- Rider liveness
--
-- `riders.status` was previously a manual toggle: a rider flipped it to
-- "online" and it stayed there forever, even after they closed the app. That
-- made "online" meaningless - all riders looked online while none were
-- reporting a position.
--
-- `last_seen_at` is the real signal, written by /api/rider/heartbeat. Status is
-- then DERIVED from it at read time, so it can never go stale.
--
-- Idempotent: safe to re-run against a database that already has the column.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_riders_last_seen ON public.riders(last_seen_at);
