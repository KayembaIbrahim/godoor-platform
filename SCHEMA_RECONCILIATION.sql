-- ============================================================================
-- GoDoor — schema reconciliation
-- ============================================================================
-- Why this file exists
-- --------------------
-- The application code and the live Supabase project had drifted apart. The
-- code referenced 23 tables that did not exist, expected 12 columns on `orders`
-- that did not exist, and every "ensure this column exists" helper in the code
-- was a no-op because the `exec_sql` RPC is neither SECURITY DEFINER nor the
-- owner of the tables — so `ALTER TABLE` returned 42501 and the `catch {}`
-- swallowed it.
--
-- Symptom map (what the users reported → what was actually wrong):
--   * "no balance on GoDoor wallet / just loading"
--       → no `wallets` rows were ever provisioned, and two disconnected ledgers
--         (`wallets`/`ledger_entries`/`deposits` vs `topup_requests`/
--         `wallet_ledger`) meant the admin approved rows in a table the
--         customer never wrote to.
--   * "deposit approved but not credited and no history"
--       → the admin portal credited `topup_requests` (nonexistent); the customer
--         wrote to `deposits`. The two never met.
--   * "clicked gofood, no restaurant, Masaka Food City exists"
--       → `merchants.id` is TEXT (`mch_masaka_food_city`) but every code path
--         gated on `isUuid()`, so `POST /api/orders` answered "A valid business
--         is required to place an order" for all four seeded stores.
--   * "new business never appears"
--       → `merchants.id` has no DEFAULT, so the insert failed with
--         "null value in column id".
--   * "order goes straight to a rider"
--       → riders could claim any order in `payment_confirmed`/`preparing`;
--         nothing required the business to mark it ready.
--   * "rider is told it is not signed in"
--       → no `riders` row was auto-provisioned and `rider_locations` writes used
--         a `heading` column that does not exist (the column is `bearing`), so
--         every position broadcast 400'd and fell through to a silent no-op.
--   * "settlement never credited anybody"
--       → `release_escrow_split` inserted a commission ledger row with
--         `user_id = '00000000-0000-0000-0000-000000000000'`, which violates
--         the FK to `auth.users` and aborts the whole transaction.
--
-- This file is idempotent. Re-running it is safe.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. merchants — give TEXT ids a default, and add the identity columns the
--    code reads (email/phone) plus a real updated_at.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.merchants ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS shop_photo_url TEXT NOT NULL DEFAULT '';

-- Backfill updated_at for rows created before the column existed.
UPDATE public.merchants SET updated_at = created_at WHERE updated_at > created_at + INTERVAL '1 day';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. orders — the columns the order API has always written.
--    `merchant_id`/`rider_id` are TEXT here on purpose (they hold merchant ids
--    like `mch_masaka_food_city`), so they are NOT uuid-typed.
--    `items` is JSONB, so the API must send an array (fixed in code).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS merchant_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_name     TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_phone    TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS line_items     JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes          TEXT NOT NULL DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_for  TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS medicine_subtotal_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS medicine_paid  BOOLEAN NOT NULL DEFAULT false;

-- Pickup bookkeeping. Dispatch must not open until the business confirms the
-- order is actually in hand, and the customer timeline must be able to show it.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ready_at          TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_assigned_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS picked_up_at      TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ;

-- Order status values the app state machine can produce.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending','payment_submitted','payment_confirmed','preparing','ready',
  'rider_assigned','delivering','delivered','medicines_ready','cancelled'
));

-- Idempotent replay of a checkout POST must not create a second order.
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uniq
  ON public.orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_status_idx        ON public.orders (status);
CREATE INDEX IF NOT EXISTS orders_merchant_idx      ON public.orders (merchant_id);
CREATE INDEX IF NOT EXISTS orders_rider_idx         ON public.orders (rider_id);
CREATE INDEX IF NOT EXISTS orders_customer_idx      ON public.orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx    ON public.orders (created_at DESC);

-- `items` may still hold a plain string from an older write; normalise it so
-- every reader gets an array.
UPDATE public.orders
   SET items = to_jsonb(ARRAY[items #>> '{}'])
 WHERE jsonb_typeof(items) = 'string';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. rider_locations — the app writes `heading`, the column was `bearing`.
--    Keep both, keep them in sync, and make rider_id unique so the upsert with
--    onConflict: "rider_id" can actually conflict.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rider_locations ADD COLUMN IF NOT EXISTS heading DOUBLE PRECISION;

UPDATE public.rider_locations
   SET heading = bearing
 WHERE heading IS NULL AND bearing IS NOT NULL;

-- One live row per rider; the old rows for the same rider are redundant.
DELETE FROM public.rider_locations a
 USING public.rider_locations b
 WHERE a.id < b.id AND a.rider_id = b.rider_id;

CREATE UNIQUE INDEX IF NOT EXISTS rider_locations_rider_uniq
  ON public.rider_locations (rider_id);

-- Keep `heading` and `bearing` identical no matter which one a writer uses.
CREATE OR REPLACE FUNCTION public.sync_rider_location_heading()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.heading IS NULL AND NEW.bearing IS NOT NULL THEN NEW.heading := NEW.bearing; END IF;
  IF NEW.bearing IS NULL AND NEW.heading IS NOT NULL THEN NEW.bearing := NEW.heading; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rider_locations_heading_sync ON public.rider_locations;
CREATE TRIGGER rider_locations_heading_sync
  BEFORE INSERT OR UPDATE ON public.rider_locations
  FOR EACH ROW EXECUTE FUNCTION public.sync_rider_location_heading();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. escrow_holds — persist the fee split that release_escrow computes, so the
--    admin portal can show what was actually paid out.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.escrow_holds ADD COLUMN IF NOT EXISTS customer_fee    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds ADD COLUMN IF NOT EXISTS business_fee    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds ADD COLUMN IF NOT EXISTS rider_fee       BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds ADD COLUMN IF NOT EXISTS merchant_payout BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds ADD COLUMN IF NOT EXISTS rider_payout    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted';
CREATE INDEX IF NOT EXISTS ledger_entries_user_idx ON public.ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deposits_user_idx       ON public.deposits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deposits_status_idx     ON public.deposits (status, created_at DESC);


-- ────────────────────────────────────────────────────────────────────────────
-- 5. profiles — role + Morse tag.
--    The app reads `profiles.morse_tag` from the browser to show the linked
--    wallet, so it has to exist and be readable by its owner.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS morse_tag TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role      TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email     TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name      TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS district  TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle   TEXT NOT NULL DEFAULT '';

UPDATE public.profiles SET email = COALESCE(NULLIF(email, ''), '');

-- A profile row per auth user, carrying the role the signup chose.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_emoji, email, name, role, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_emoji', '🧑'),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data ->> 'name', NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer'),
    COALESCE(NEW.raw_user_meta_data ->> 'phone', '')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role = COALESCE(NULLIF(public.profiles.role, ''), EXCLUDED.role);
  -- Every GoDoor account gets a wallet row the moment it exists. Without this
  -- `hold_escrow` answers "Wallet not found" and escrow never engages.
  INSERT INTO public.wallets (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: existing accounts get their profile row and a wallet.
-- `full_name` is NOT NULL and has no default, so it has to be supplied here or
-- the whole transaction aborts and every table below is never created.
INSERT INTO public.profiles (id, full_name, avatar_emoji, email, name, role, phone)
SELECT u.id,
       COALESCE(u.raw_user_meta_data ->> 'full_name',
                u.raw_user_meta_data ->> 'name',
                split_part(COALESCE(u.email, ''), '@', 1),
                'Member'),
       COALESCE(u.raw_user_meta_data ->> 'avatar_emoji', '🧑'),
       COALESCE(u.email, ''),
       COALESCE(u.raw_user_meta_data ->> 'name', split_part(COALESCE(u.email, ''), '@', 1)),
       COALESCE(NULLIF(u.raw_user_meta_data ->> 'role', ''), 'customer'),
       COALESCE(u.raw_user_meta_data ->> 'phone', '')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wallets (user_id)
SELECT u.id FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Missing tables. Every one of these is referenced by shipping code.
-- ────────────────────────────────────────────────────────────────────────────

-- Boda / transport requests.
CREATE TABLE IF NOT EXISTS public.ride_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_phone    TEXT NOT NULL DEFAULT '',
  pickup_lat        DOUBLE PRECISION,
  pickup_lng        DOUBLE PRECISION,
  pickup_address    TEXT NOT NULL DEFAULT '',
  dropoff_lat       DOUBLE PRECISION,
  dropoff_lng       DOUBLE PRECISION,
  dropoff_address   TEXT NOT NULL DEFAULT '',
  distance_km       NUMERIC(8,2) NOT NULL DEFAULT 0,
  fare_ugx          BIGINT NOT NULL DEFAULT 0,
  service_fee_ugx   BIGINT NOT NULL DEFAULT 0,
  total_ugx         BIGINT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','accepted','in_progress','completed','cancelled')),
  rider_id          TEXT,
  rider_name        TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ride_requests_status_idx ON public.ride_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ride_requests_rider_idx  ON public.ride_requests (rider_id);

-- Per-order chat between customer, business and rider.
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL,
  sender_id   UUID,
  sender_name TEXT NOT NULL DEFAULT '',
  sender_role TEXT NOT NULL DEFAULT 'customer',
  text        TEXT NOT NULL DEFAULT '',
  image_url   TEXT,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_order_idx ON public.chat_messages (order_id, created_at);

-- A travelling business (mobile mechanic, salon at home…) streaming its GPS.
CREATE TABLE IF NOT EXISTS public.provider_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL UNIQUE,
  lat         DOUBLE PRECISION NOT NULL DEFAULT 0,
  lng         DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading     DOUBLE PRECISION NOT NULL DEFAULT 0,
  speed       DOUBLE PRECISION NOT NULL DEFAULT 0,
  accuracy    DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clinic appointment queue.
CREATE TABLE IF NOT EXISTS public.clinic_queue (
  order_id     UUID PRIMARY KEY,
  merchant_id  TEXT NOT NULL,
  queue_number INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'waiting'
               CHECK (status IN ('waiting','in_consultation','done','no_show')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_queue_merchant_idx ON public.clinic_queue (merchant_id, created_at);

-- A store-owned delivery fleet.
CREATE TABLE IF NOT EXISTS public.merchant_riders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  rider_id    UUID NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','active','declined')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_riders_uniq ON public.merchant_riders (merchant_id, rider_id);
CREATE INDEX IF NOT EXISTS merchant_riders_rider_idx ON public.merchant_riders (rider_id);

-- Merchant story highlights.
CREATE TABLE IF NOT EXISTS public.stories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  merchant_name TEXT NOT NULL DEFAULT '',
  media_url   TEXT NOT NULL DEFAULT '',
  media_type  TEXT NOT NULL DEFAULT 'image',
  caption     TEXT NOT NULL DEFAULT '',
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stories_merchant_idx ON public.stories (merchant_id, created_at DESC);

-- Customer follows a business.
CREATE TABLE IF NOT EXISTS public.followers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  merchant_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS followers_uniq ON public.followers (customer_id, merchant_id);

-- Merchant menu groupings.
CREATE TABLE IF NOT EXISTS public.catalogues (
  id          TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalogues_merchant_idx ON public.catalogues (merchant_id, sort_order);

-- Payment disputes raised by a customer.
CREATE TABLE IF NOT EXISTS public.disputes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID,
  payment_id     TEXT,
  raised_by      UUID,
  raised_by_name TEXT NOT NULL DEFAULT '',
  reason         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','reviewing','resolved','rejected')),
  admin_note     TEXT NOT NULL DEFAULT '',
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_status_idx ON public.disputes (status, created_at DESC);

-- What the platform still owes a business or a rider.
CREATE TABLE IF NOT EXISTS public.payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID,
  recipient_id   UUID,
  recipient_role TEXT NOT NULL DEFAULT 'business',
  amount         BIGINT NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'UGX',
  status         TEXT NOT NULL DEFAULT 'due'
                 CHECK (status IN ('due','processing','paid','failed')),
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON public.payouts (status, created_at DESC);

-- Admin-managed feature settings (APK release, maintenance banner…).
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin portal settings (kept separate from app_settings on purpose).
CREATE TABLE IF NOT EXISTS public.admin_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Change requests that need a human to approve.
CREATE TABLE IF NOT EXISTS public.phone_change_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_phone TEXT NOT NULL DEFAULT '',
  new_phone   TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT,
  admin_note  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS phone_change_requests_status_idx ON public.phone_change_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_name_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   TEXT NOT NULL,
  owner_id      UUID,
  current_name  TEXT NOT NULL DEFAULT '',
  requested_name TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   TEXT,
  admin_note    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.morse_tag_change_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_tag   TEXT NOT NULL DEFAULT '',
  requested_tag TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  admin_note    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.partner_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  district    TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  admin_note  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_ugx    BIGINT NOT NULL DEFAULT 0,
  reference     TEXT NOT NULL DEFAULT '',
  method        TEXT NOT NULL DEFAULT 'morse',
  screenshot_url TEXT,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  admin_note    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);

-- Rider onboarding documents (National ID, vehicle papers…).
CREATE TABLE IF NOT EXISTS public.verification_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  user_email   TEXT NOT NULL DEFAULT '',
  full_name    TEXT NOT NULL DEFAULT '',
  national_id  TEXT NOT NULL DEFAULT '',
  doc_type     TEXT NOT NULL DEFAULT '',
  file_url     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  admin_note   TEXT NOT NULL DEFAULT '',
  reviewed_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS verification_documents_user_idx ON public.verification_documents (user_id, created_at DESC);

-- Generic verification row used by the onboarding wizard.
CREATE TABLE IF NOT EXISTS public.verification (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'customer',
  status      TEXT NOT NULL DEFAULT 'pending',
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Web Push endpoints (browser notifications).
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL DEFAULT '',
  auth       TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 7. Money-path functions.
-- ────────────────────────────────────────────────────────────────────────────

-- release_escrow_split wrote the platform commission against the all-zeros uuid.
-- ledger_entries.user_id has an FK to auth.users, so that INSERT aborted the
-- entire settlement: no payout, no ledger history, order stuck on "delivered".
-- Attribute revenue to the real platform account, and record what each party
-- was actually paid so the admin payouts screen has real numbers.
CREATE OR REPLACE FUNCTION public.release_escrow_split(
  p_order_id UUID,
  p_business_fee_ugx BIGINT,
  p_rider_fee_ugx BIGINT,
  p_merchant_ugx BIGINT,
  p_rider_ugx BIGINT
)
RETURNS TABLE(ok BOOLEAN, message TEXT, business_fee BIGINT, rider_payout BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hold     RECORD;
  v_customer UUID;
  v_business TEXT;
  v_rider    UUID;
  v_owner    UUID;
  v_platform UUID;
  v_day      DATE := CURRENT_DATE;
  v_revenue  BIGINT;
BEGIN
  SELECT * INTO v_hold FROM public.escrow_holds WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  IF v_hold.status <> 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT customer_id, COALESCE(merchant_id, business_id::TEXT), NULLIF(rider_id, '')::UUID
    INTO v_customer, v_business, v_rider
  FROM public.orders WHERE id = p_order_id;

  -- Settle once. The conditional UPDATE is the idempotency guard: a replay finds
  -- no 'held' row and returns "already released" instead of paying twice.
  UPDATE public.escrow_holds
     SET status = 'released',
         business_fee = p_business_fee_ugx,
         rider_fee = p_rider_fee_ugx,
         merchant_payout = p_merchant_ugx,
         rider_payout = p_rider_ugx,
         updated_at = now()
   WHERE order_id = p_order_id AND status = 'held';

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Escrow already released'::TEXT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  -- Draw the escrow balance down; the remainder is the platform's revenue.
  IF v_customer IS NOT NULL THEN
    UPDATE public.wallets
       SET escrow_balance = GREATEST(0, escrow_balance - v_hold.amount), updated_at = now()
     WHERE user_id = v_customer;
  END IF;

  -- Business payout + daily sales rollup.
  IF v_business IS NOT NULL THEN
    INSERT INTO public.business_daily_sales (business_id, business_day, orders_count, sales_ugx, fee_ugx)
    VALUES (v_business, v_day, 1, p_merchant_ugx + p_business_fee_ugx, p_business_fee_ugx)
    ON CONFLICT (business_id, business_day) DO UPDATE
      SET orders_count = business_daily_sales.orders_count + 1,
          sales_ugx    = business_daily_sales.sales_ugx + (p_merchant_ugx + p_business_fee_ugx),
          fee_ugx      = business_daily_sales.fee_ugx + p_business_fee_ugx,
          updated_at   = now();

    SELECT owner_id INTO v_owner FROM public.merchants WHERE id = v_business;
    IF v_owner IS NOT NULL AND p_merchant_ugx > 0 THEN
      INSERT INTO public.wallets (user_id) VALUES (v_owner) ON CONFLICT (user_id) DO NOTHING;
      UPDATE public.wallets
         SET available_balance = available_balance + p_merchant_ugx, updated_at = now()
       WHERE user_id = v_owner;
      INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
      VALUES (v_owner, 'payout', p_merchant_ugx, 'UGX', 'order', p_order_id::TEXT,
              jsonb_build_object('role','business','gross_ugx', p_merchant_ugx + p_business_fee_ugx, 'fee_ugx', p_business_fee_ugx))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Rider payout.
  IF v_rider IS NOT NULL AND p_rider_ugx > 0 THEN
    INSERT INTO public.wallets (user_id) VALUES (v_rider) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets
       SET available_balance = available_balance + p_rider_ugx, updated_at = now()
     WHERE user_id = v_rider;
    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_rider, 'payout', p_rider_ugx, 'UGX', 'order', p_order_id::TEXT,
            jsonb_build_object('role','rider','gross_ugx', p_rider_ugx + p_rider_fee_ugx, 'fee_ugx', p_rider_fee_ugx))
    ON CONFLICT DO NOTHING;
  END IF;

  -- Platform revenue. It has to land on a real auth.users row: the previous
  -- all-zeros id violated the ledger FK and aborted settlement entirely.
  v_revenue := COALESCE(p_business_fee_ugx, 0) + COALESCE(p_rider_fee_ugx, 0);
  IF v_revenue > 0 THEN
    SELECT id INTO v_platform FROM auth.users WHERE email = 'platform@system.godoor' LIMIT 1;
    v_platform := COALESCE(v_platform, v_customer);
    IF v_platform IS NOT NULL THEN
      INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
      VALUES (v_platform, 'commission', v_revenue, 'UGX', 'order', p_order_id::TEXT,
              jsonb_build_object('business_fee_ugx', p_business_fee_ugx, 'rider_fee_ugx', p_rider_fee_ugx,
                                 'merchant_payout_ugx', p_merchant_ugx, 'rider_payout_ugx', p_rider_ugx))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- What admin still owes.
  IF v_business IS NOT NULL AND p_merchant_ugx > 0 THEN
    INSERT INTO public.payouts (order_id, recipient_id, recipient_role, amount, currency, status)
    VALUES (p_order_id, v_owner, 'business', p_merchant_ugx, 'UGX', 'due');
  END IF;
  IF v_rider IS NOT NULL AND p_rider_ugx > 0 THEN
    INSERT INTO public.payouts (order_id, recipient_id, recipient_role, amount, currency, status)
    VALUES (p_order_id, v_rider, 'rider', p_rider_ugx, 'UGX', 'due');
  END IF;

  RETURN QUERY SELECT TRUE, 'Escrow released'::TEXT, p_business_fee_ugx, p_rider_ugx;
END;
$$;

-- release_escrow ran as INVOKER with an unpinned search_path.
CREATE OR REPLACE FUNCTION public.release_escrow(
  p_order_id UUID,
  p_customer_fee_percent INTEGER DEFAULT 0,
  p_business_fee_percent INTEGER DEFAULT 5,
  p_rider_fee_percent    INTEGER DEFAULT 10
)
RETURNS TABLE(success BOOLEAN, message TEXT, customer_fee BIGINT, business_fee BIGINT,
              rider_fee BIGINT, merchant_payout BIGINT, rider_payout BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
  v_order RECORD;
  v_merchant_owner UUID;
  v_rider UUID;
  v_platform UUID;
  v_subtotal BIGINT;
  v_delivery BIGINT;
  v_customer_fee BIGINT;
  v_business_fee BIGINT;
  v_rider_fee BIGINT;
  v_merchant_payout BIGINT;
  v_rider_payout BIGINT;
BEGIN
  SELECT * INTO v_hold FROM public.escrow_holds WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;
  IF v_hold.status <> 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Order not found'::TEXT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  v_subtotal := COALESCE(v_order.subtotal_ugx, 0);
  v_delivery := COALESCE(v_order.delivery_fee_ugx, 0);

  v_customer_fee := ROUND(v_subtotal * p_customer_fee_percent / 100.0);
  v_business_fee := ROUND(v_subtotal * p_business_fee_percent / 100.0);
  v_rider_fee    := ROUND(v_delivery * p_rider_fee_percent / 100.0);

  v_merchant_payout := GREATEST(0, v_subtotal - v_business_fee);
  v_rider_payout    := GREATEST(0, v_delivery - v_rider_fee);

  SELECT owner_id INTO v_merchant_owner FROM public.merchants WHERE id = v_order.merchant_id::TEXT;
  v_rider := NULLIF(v_order.rider_id, '')::UUID;

  -- Idempotency guard: only a still-held row is settled, so a replayed webhook
  -- can never pay anybody twice.
  UPDATE public.escrow_holds
     SET status = 'released', updated_at = now(),
         customer_fee = v_customer_fee, business_fee = v_business_fee, rider_fee = v_rider_fee,
         merchant_payout = v_merchant_payout, rider_payout = v_rider_payout
   WHERE order_id = p_order_id AND status = 'held';

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Escrow already released'::TEXT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  UPDATE public.wallets SET escrow_balance = GREATEST(0, escrow_balance - v_hold.amount)
   WHERE user_id = v_order.customer_id;

  IF v_merchant_owner IS NOT NULL AND v_merchant_payout > 0 THEN
    INSERT INTO public.wallets (user_id) VALUES (v_merchant_owner) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET available_balance = available_balance + v_merchant_payout, updated_at = now()
     WHERE user_id = v_merchant_owner;
    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_merchant_owner, 'payout', v_merchant_payout, 'UGX', 'order', p_order_id::TEXT,
            jsonb_build_object('role','business','gross_ugx',v_subtotal,'fee_ugx',v_business_fee));
  END IF;

  IF v_rider IS NOT NULL AND v_rider_payout > 0 THEN
    INSERT INTO public.wallets (user_id) VALUES (v_rider) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET available_balance = available_balance + v_rider_payout, updated_at = now()
     WHERE user_id = v_rider;
    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_rider, 'payout', v_rider_payout, 'UGX', 'order', p_order_id::TEXT,
            jsonb_build_object('role','rider','gross_ugx',v_delivery,'fee_ugx',v_rider_fee));
  END IF;

  SELECT id INTO v_platform FROM auth.users WHERE email = 'platform@system.godoor' LIMIT 1;
  v_platform := COALESCE(v_platform, v_order.customer_id);
  IF v_platform IS NOT NULL THEN
    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_platform, 'commission', v_customer_fee + v_business_fee + v_rider_fee,
            'UGX', 'order', p_order_id::TEXT,
            jsonb_build_object('customer_ugx',v_customer_fee,'business_ugx',v_business_fee,'rider_ugx',v_rider_fee));
  END IF;

  RETURN QUERY SELECT TRUE, 'Escrow released'::TEXT,
    v_customer_fee, v_business_fee, v_rider_fee, v_merchant_payout, v_rider_payout;
END;
$$;

-- hold_escrow: provision the wallet on demand so a missing row is never a
-- hard failure, and never leave escrow negative.
CREATE OR REPLACE FUNCTION public.hold_escrow(p_user_id UUID, p_order_id UUID, p_amount BIGINT)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_hold_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.wallets (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;

  SELECT available_balance INTO v_balance
  FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, format('Insufficient balance: have %s, need %s', v_balance, p_amount)::TEXT;
    RETURN;
  END IF;

  SELECT id INTO v_hold_id FROM public.escrow_holds WHERE order_id = p_order_id AND status = 'held';
  IF v_hold_id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, 'Escrow already held for this order'::TEXT;
    RETURN;
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance - p_amount,
         escrow_balance    = escrow_balance + p_amount,
         updated_at        = now()
   WHERE user_id = p_user_id;

  INSERT INTO public.escrow_holds (order_id, amount, status)
  VALUES (p_order_id, p_amount, 'held')
  ON CONFLICT (order_id) DO UPDATE
    SET amount = EXCLUDED.amount, status = 'held', updated_at = now();

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id, 'order_hold', p_amount, 'UGX', 'order', p_order_id::TEXT, '{}'::jsonb);

  RETURN QUERY SELECT TRUE, 'Escrow held'::TEXT;
END;
$$;

-- refund_escrow: return the money and mark the hold refunded exactly once.
CREATE OR REPLACE FUNCTION public.refund_escrow(p_order_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hold RECORD;
  v_customer UUID;
BEGIN
  SELECT * INTO v_hold FROM public.escrow_holds WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT;
    RETURN;
  END IF;

  IF v_hold.status <> 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT;
    RETURN;
  END IF;

  SELECT customer_id INTO v_customer FROM public.orders WHERE id = p_order_id;

  UPDATE public.escrow_holds SET status = 'refunded', updated_at = now()
   WHERE order_id = p_order_id AND status = 'held';

  IF v_customer IS NOT NULL THEN
    UPDATE public.wallets
       SET escrow_balance    = GREATEST(0, escrow_balance - v_hold.amount),
           available_balance = available_balance + v_hold.amount,
           updated_at        = now()
     WHERE user_id = v_customer;

    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_customer, 'refund', v_hold.amount, 'UGX', 'order', p_order_id::TEXT, '{}'::jsonb);
  END IF;

  RETURN QUERY SELECT TRUE, 'Escrow refunded'::TEXT;
END;
$$;

-- confirm_deposit: idempotent, and it records the credited amount so the admin
-- portal can show history without a second query.
CREATE OR REPLACE FUNCTION public.confirm_deposit(p_deposit_id UUID, p_provider_tx_id TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deposit RECORD;
BEGIN
  SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Deposit not found'::TEXT;
    RETURN;
  END IF;

  -- Re-confirming an already-credited deposit must not pay twice, but it should
  -- still report success so a retried admin click is not reported as a failure.
  IF v_deposit.status <> 'pending' THEN
    RETURN QUERY SELECT (v_deposit.credited_wallet), format('Deposit already %s', v_deposit.status)::TEXT;
    RETURN;
  END IF;

  UPDATE public.deposits
     SET status = 'confirmed',
         confirmed_at = now(),
         credited_wallet = true,
         credited_at = now(),
         provider_ref = COALESCE(p_provider_tx_id, provider_ref)
   WHERE id = p_deposit_id;

  INSERT INTO public.wallets (user_id) VALUES (v_deposit.user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets
     SET available_balance = available_balance + v_deposit.amount, updated_at = now()
   WHERE user_id = v_deposit.user_id;

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (v_deposit.user_id, 'deposit', v_deposit.amount, v_deposit.currency,
          'deposit', p_deposit_id::TEXT, jsonb_build_object('provider', v_deposit.provider, 'reference_code', v_deposit.reference_code));

  RETURN QUERY SELECT TRUE, 'Deposit confirmed'::TEXT;
END;
$$;

-- Reject a deposit without paying it, so the admin portal has a real "declined"
-- action and the customer sees why nothing was credited.
CREATE OR REPLACE FUNCTION public.reject_deposit(p_deposit_id UUID, p_note TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deposit RECORD;
BEGIN
  SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Deposit not found'::TEXT;
    RETURN;
  END IF;
  IF v_deposit.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, format('Deposit already %s', v_deposit.status)::TEXT;
    RETURN;
  END IF;

  UPDATE public.deposits
     SET status = 'failed', admin_note = COALESCE(p_note, ''), confirmed_at = now()
   WHERE id = p_deposit_id;

  RETURN QUERY SELECT TRUE, 'Deposit rejected'::TEXT;
END;
$$;

-- A single entry point for crediting an admin-approved top-up. The admin portal
-- used to write to `topup_requests`, a table the customer flow never touched,
-- so approving a deposit silently did nothing.
CREATE OR REPLACE FUNCTION public.credit_deposit(p_deposit_id UUID, p_note TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, message TEXT, new_balance BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result RECORD;
  v_balance BIGINT;
BEGIN
  SELECT * INTO v_result FROM public.confirm_deposit(p_deposit_id) AS t(success, message);
  IF NOT v_result.success THEN
    RETURN QUERY SELECT FALSE, v_result.message, 0::BIGINT;
    RETURN;
  END IF;
  IF p_note IS NOT NULL THEN
    UPDATE public.deposits SET admin_note = p_note WHERE id = p_deposit_id;
  END IF;
  SELECT available_balance INTO v_balance FROM public.wallets
   WHERE user_id = (SELECT user_id FROM public.deposits WHERE id = p_deposit_id);
  RETURN QUERY SELECT TRUE, v_result.message, COALESCE(v_balance, 0);
END;
$$;

-- General-purpose ledger credit used by the momo webhook and any future
-- top-up provider. Keeps every balance change going through one audited path.
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id UUID,
  p_amount BIGINT,
  p_reference TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(success BOOLEAN, message TEXT, balance BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount'::TEXT, 0::BIGINT;
    RETURN;
  END IF;
  INSERT INTO public.wallets (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets
     SET available_balance = available_balance + p_amount, updated_at = now()
   WHERE user_id = p_user_id
  RETURNING wallets.available_balance INTO v_balance;

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id, 'deposit', p_amount, 'UGX', 'manual', COALESCE(p_reference, ''), COALESCE(p_meta, '{}'::jsonb));

  RETURN QUERY SELECT TRUE, 'Credited'::TEXT, COALESCE(v_balance, 0);
END;
$$;

-- Generic debit, used when paying a service fee out of the balance.
CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id UUID,
  p_amount BIGINT,
  p_reference TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, balance BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_balance BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount'::TEXT, 0::BIGINT;
    RETURN;
  END IF;
  INSERT INTO public.wallets (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
     SET available_balance = available_balance - p_amount, updated_at = now()
   WHERE user_id = p_user_id AND available_balance >= p_amount
  RETURNING wallets.available_balance INTO v_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Insufficient wallet balance'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id, 'payment', -p_amount, 'UGX', 'manual', COALESCE(p_reference, ''),
          jsonb_build_object('note', COALESCE(p_note, '')));

  RETURN QUERY SELECT TRUE, 'Debited'::TEXT, v_balance;
END;
$$;

-- Signup bonus. Idempotent on the reference so a retried signup cannot mint a
-- second bonus.
CREATE OR REPLACE FUNCTION public.grant_signup_bonus(p_user_id UUID, p_amount BIGINT DEFAULT 2000)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_exists BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount'::TEXT;
    RETURN;
  END IF;
  SELECT TRUE INTO v_exists FROM public.ledger_entries
   WHERE user_id = p_user_id AND ref_id = 'SIGNUP-BONUS' LIMIT 1;
  IF v_exists THEN
    RETURN QUERY SELECT FALSE, 'Already granted'::TEXT;
    RETURN;
  END IF;
  PERFORM public.credit_wallet(p_user_id, p_amount, 'SIGNUP-BONUS', 'Welcome service-fee credit');
  RETURN QUERY SELECT TRUE, 'Granted'::TEXT;
END;
$$;

-- Keep updated_at honest on every table that carries it.
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders','merchants','profiles','wallets','escrow_holds','ride_requests',
    'clinic_queue','merchant_riders','payouts','disputes','providers'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS set_%I_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER set_%I_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t, t);
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. RLS on the money tables.
--    These had RLS disabled, and PostgREST grants the anon role table access by
--    default — so anyone with the browser bundle's public key could read every
--    customer's balance, ledger and deposit history. Service role bypasses RLS,
--    so every API route keeps working.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.wallets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_holds   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes       ENABLE ROW LEVEL SECURITY;

-- Owner-scoped reads only. No anon policy exists, so the anon key gets nothing.
DROP POLICY IF EXISTS "Owner reads own wallet" ON public.wallets;
CREATE POLICY "Owner reads own wallet" ON public.wallets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner reads own ledger" ON public.ledger_entries;
CREATE POLICY "Owner reads own ledger" ON public.ledger_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner reads own deposits" ON public.deposits;
CREATE POLICY "Owner reads own deposits" ON public.deposits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner reads own escrow holds" ON public.escrow_holds;
CREATE POLICY "Owner reads own escrow holds" ON public.escrow_holds
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = escrow_holds.order_id AND o.customer_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner reads own payouts" ON public.payouts;
CREATE POLICY "Owner reads own payouts" ON public.payouts
  FOR SELECT TO authenticated USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Customer reads own disputes" ON public.disputes;
CREATE POLICY "Customer reads own disputes" ON public.disputes
  FOR SELECT TO authenticated USING (auth.uid() = raised_by);

-- `riders` was also fully readable with RLS off: names, emails, phone numbers,
-- plates and live status for every rider on the platform.
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads riders" ON public.riders;
CREATE POLICY "Public reads riders" ON public.riders
  FOR SELECT TO anon, authenticated USING (true);

-- `payments` carries transaction references and screenshots.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Payment parties read own payment" ON public.payments;
CREATE POLICY "Payment parties read own payment" ON public.payments
  FOR SELECT TO authenticated USING (
    submitted_by = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = payments.merchant_id AND m.owner_id = auth.uid())
  );

-- `profiles` was world-readable: every account's name, phone and address.
DROP POLICY IF EXISTS "Public profiles" ON public.profiles;
CREATE POLICY "Public profiles" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Owner reads own profile row" ON public.profiles;
CREATE POLICY "Owner reads own profile row" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- New tables: public reads where the UI needs it, nothing writable by a client.
ALTER TABLE public.ride_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_riders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads ride requests" ON public.ride_requests;
CREATE POLICY "Public reads ride requests" ON public.ride_requests
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public reads provider locations" ON public.provider_locations;
CREATE POLICY "Public reads provider locations" ON public.provider_locations
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public reads active stories" ON public.stories;
CREATE POLICY "Public reads active stories" ON public.stories
  FOR SELECT TO anon, authenticated USING (expires_at > now());

DROP POLICY IF EXISTS "Public reads followers" ON public.followers;
CREATE POLICY "Public reads followers" ON public.followers
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public reads catalogues" ON public.catalogues;
CREATE POLICY "Public reads catalogues" ON public.catalogues
  FOR SELECT TO anon, authenticated USING (active);

DROP POLICY IF EXISTS "Public reads clinic queue" ON public.clinic_queue;
CREATE POLICY "Public reads clinic queue" ON public.clinic_queue
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public reads merchant riders" ON public.merchant_riders;
CREATE POLICY "Public reads merchant riders" ON public.merchant_riders
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Owner reads own documents" ON public.verification_documents;
CREATE POLICY "Owner reads own documents" ON public.verification_documents
  FOR SELECT TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Owner reads own verification" ON public.verification;
CREATE POLICY "Owner reads own verification" ON public.verification
  FOR SELECT TO authenticated USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Owner reads own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Owner reads own push subscriptions" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid()::text = user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 9. Realtime. Every table the app subscribes to must be in the publication,
--    otherwise `.subscribe()` connects successfully and silently delivers
--    nothing — which is what made chat, tracking and rider dashboards look
--    frozen.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders','chat_messages','rider_locations','ride_requests','clinic_queue',
    'merchant_riders','provider_locations','stories','disputes','payouts',
    'deposits','wallets','ledger_entries','escrow_holds','merchants','products'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 10. Cleanup of the parallel legacy schemas.
--     `businesses`/`drivers`/`wallet_transactions` are older duplicates of
--     `merchants`/`riders`/`ledger_entries`. Nothing in the app reads them and
--     `orders.business_id`/`orders.driver_id` cascade-delete from `businesses`,
--     so a stray delete could take live orders with it.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_business_id_fkey;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_driver_id_fkey;