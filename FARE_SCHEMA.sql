-- ─────────────────────────────────────────────────────────────────────────────
-- Fare engine configuration + stopover/waiting accounting
--
-- WHY
-- ---
-- Fare maths lived in three places with three different formulas, so a customer
-- and a rider could be shown two different numbers for the same trip:
--   • POST /api/rides      hardcoded 2,000 + 1,200/km, then serviceFeeFor()
--   • /ride (customer UI)  hardcoded 2,000 + 1,200/km, then a HARDCODED 5% fee
--   • /api/orders          calcDeliveryFee() at 200/km + 100/min
-- On a 10 km ride the customer saw 14,700 and was charged 16,100.
--
-- Everything is now priced by `src/lib/fare-engine.ts` (quoteFare) on the
-- server, and the customer renders a quote returned by that same function.
--
-- This file adds the columns the engine reads. All statements are idempotent,
-- so re-running is safe — required, because the admin push tool re-applies the
-- whole file.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Admin-editable fare rates ────────────────────────────────────────────
--
-- One row, id = 'default', same convention as the existing fee_config table.
-- Every column is nullable so the engine can fall back to FALLBACK_FARE_RATES
-- per-field; a missing column must never price a ride at zero.
CREATE TABLE IF NOT EXISTS public.fare_rates (
  id TEXT PRIMARY KEY DEFAULT 'default',

  /* Boda / GoRide */
  boda_base_ugx        INTEGER NOT NULL DEFAULT 2000,
  boda_per_km_ugx      INTEGER NOT NULL DEFAULT 1200,
  boda_per_min_ugx     INTEGER NOT NULL DEFAULT 0,
  boda_min_ugx         INTEGER NOT NULL DEFAULT 2500,

  /* GoCar */
  car_base_ugx         INTEGER NOT NULL DEFAULT 3500,
  car_per_km_ugx       INTEGER NOT NULL DEFAULT 1800,
  car_min_ugx          INTEGER NOT NULL DEFAULT 4000,

  /* Delivery — time-of-day minimums */
  delivery_base_ugx          INTEGER NOT NULL DEFAULT 0,
  delivery_per_km_ugx        INTEGER NOT NULL DEFAULT 200,
  delivery_per_min_ugx       INTEGER NOT NULL DEFAULT 100,
  delivery_min_day_ugx       INTEGER NOT NULL DEFAULT 1500,
  delivery_min_evening_ugx   INTEGER NOT NULL DEFAULT 2000,
  delivery_min_late_ugx      INTEGER NOT NULL DEFAULT 3000,

  /* Tier boundaries as EAT hours. 19.5 = 19:30, per the operator brief. */
  evening_start_hour   NUMERIC(4,2) NOT NULL DEFAULT 19.5,
  late_start_hour      NUMERIC(4,2) NOT NULL DEFAULT 22,

  /* Peak uplift on the DISTANCE component. 1.00 = no uplift, which is the
     shipped default: turning this on re-prices live rides, so it must be an
     operator decision made in the admin portal, not a side effect of deploying
     the fare engine. Clamped to 1.00-3.00 in code. */
  evening_multiplier   NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  late_multiplier      NUMERIC(4,2) NOT NULL DEFAULT 1.00,

  /* Stopover: free grace, then a per-minute charge on the customer. */
  wait_grace_min       NUMERIC(4,2) NOT NULL DEFAULT 3,
  wait_per_min_ugx     INTEGER NOT NULL DEFAULT 100,

  round_to_ugx         INTEGER NOT NULL DEFAULT 100,

  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           TEXT
);

ALTER TABLE public.fare_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fare_rates FROM anon;
GRANT SELECT ON public.fare_rates TO anon, authenticated;
GRANT ALL ON public.fare_rates TO service_role;

INSERT INTO public.fare_rates (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ─── 2. Ride fare breakdown + stopover accounting ─────────────────────────────
--
-- `quote_snapshot` stores the full itemised breakdown that produced
-- `fare_ugx`, so a dispute months later can be reconstructed exactly rather
-- than re-derived from rates that may since have changed.
ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS duration_min      NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS fare_tier         TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_kind      TEXT NOT NULL DEFAULT 'boda',
  ADD COLUMN IF NOT EXISTS base_ugx          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distance_ugx      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_ugx          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_ugx          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_min          NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_snapshot    JSONB,
  ADD COLUMN IF NOT EXISTS accepted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalised         BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotency guard for the stopover accumulator: the rider-location mutation
-- runs on every GPS ping, and two concurrent pings must not both add their
-- elapsed minutes or the customer is double-charged.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ride_active_rider
  ON public.ride_requests (rider_id)
  WHERE rider_id IS NOT NULL AND status = 'in_progress';

-- Rider's own ride history. Without this the History tab could only ever show
-- in-flight deliveries, because a completed ride fell out of the filter.
CREATE INDEX IF NOT EXISTS idx_ride_rider_created
  ON public.ride_requests (rider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ride_customer_created
  ON public.ride_requests (customer_id, created_at DESC);

-- ─── 3. Stopover events (audit trail) ─────────────────────────────────────────
--
-- A stopover is a CUSTOMER-DECLARED EVENT, not an automatic consequence of the
-- rider being slow. The rider taps "Waiting on customer", the server opens a
-- session against its own clock, the customer is told immediately, and the
-- minutes are only billed when the session closes.
--
-- Why not just bill any stationary period automatically: it made the customer
-- discover a charge they had never been told about, and it let a rider farm
-- wait time by idling at every junction. Declaring it means the charge is
-- explained before it lands, and it gives us a clean audit row per event.
CREATE TABLE IF NOT EXISTS public.ride_stopovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.ride_requests(id) ON DELETE CASCADE,

  /* Who declared it and who was waiting on. Both server-resolved. */
  rider_id  UUID,
  customer_id UUID,

  /* 'open' while the clock runs, 'closed' once billed, 'void' if discarded. */
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','void')),

  /* Server clock only. The client never supplies a timestamp. */
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,

  /* Rider's stated reason. Drives the customer's alert copy. */
  reason TEXT NOT NULL DEFAULT 'other'
    CHECK (reason IN ('customer_not_ready','customer_running_late','customer_requested',
                      'customer_unreachable','traffic_roadblock','vehicle_issue','other')),

  minutes NUMERIC(8,2) NOT NULL DEFAULT 0,
  charge_ugx INTEGER NOT NULL DEFAULT 0,

  /* Where the vehicle was, so a dispute can be checked against the route. */
  from_lat NUMERIC(9,6),
  from_lng NUMERIC(9,6),
  to_lat   NUMERIC(9,6),
  to_lng   NUMERIC(9,6),

  /* How the session ended: rider tapped End, the GPS showed movement again,
     or a cap was hit. Never 'mystery'. */
  close_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 4. Stopover caps and controls (admin-editable) ───────────────────────────
--
-- Every one of these exists to bound the damage a dishonest rider (or a
-- compromised rider session) can do. Without them, "tap the button and leave it
-- running" would drain a customer's wallet over a long evening.
ALTER TABLE public.fare_rates
  ADD COLUMN IF NOT EXISTS stopover_max_session_min   NUMERIC(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS stopover_max_ride_min      NUMERIC(5,2) NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS stopover_min_session_min   NUMERIC(5,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stopover_cooldown_min      NUMERIC(5,2) NOT NULL DEFAULT 5;

-- ─── 5. Live stopover state on the ride ───────────────────────────────────────
--
-- `stopover_open_id` is the session currently running, if any. It is the handle
-- the End button posts to, so a double-tap can never open two clocks. It is
-- nulled the moment the session closes, which is what makes "End" idempotent.
ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS stopover_open_id   UUID,
  ADD COLUMN IF NOT EXISTS stopover_open_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stopover_reason    TEXT,
  ADD COLUMN IF NOT EXISTS stopover_minutes   NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stopover_ugx       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stopover_disputed  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stopover_waived    BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 6. Disputes ──────────────────────────────────────────────────────────────
--
-- A customer who disagrees with a wait charge must be able to say so and have a
-- human look at it. Without this the only options are "pay silently" or "lose
-- the money", and a silent loss is what turns one bad trip into a 1-star review
-- and a deleted account.
CREATE TABLE IF NOT EXISTS public.ride_stopover_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.ride_requests(id) ON DELETE CASCADE,
  stopover_id UUID REFERENCES public.ride_stopovers(id) ON DELETE SET NULL,
  customer_id UUID,
  reason TEXT NOT NULL DEFAULT 'incorrect_wait',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','refunded')),
  resolved_by TEXT,
  resolved_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.ride_stopover_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_stopover_disputes FROM anon, authenticated;
GRANT ALL ON public.ride_stopover_disputes TO service_role;

CREATE INDEX IF NOT EXISTS idx_ride_stopovers_ride ON public.ride_stopovers (ride_id, created_at);

ALTER TABLE public.ride_stopovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_stopovers FROM anon, authenticated;
GRANT ALL ON public.ride_stopovers TO service_role;

-- The anti-double-bill guard, enforced by Postgres rather than by the handler.
--
-- A rider on a flaky Kampala connection will double-tap "Waiting on customer".
-- If two sessions can be open at once, the End button has to guess which to
-- close, and the customer pays twice for one stop. A partial unique index makes
-- a second open session physically impossible, so the loser of the race gets a
-- clean "already running" response instead of a second charge.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_stopover_per_ride
  ON public.ride_stopovers (ride_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_stopover_disputes_status
  ON public.ride_stopover_disputes (status, created_at DESC);