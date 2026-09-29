-- GoDoor Wallet / Escrow Schema  (production-apply)
-- Target: Supabase project llzqkduccdbbetevpoql
--
-- Fee split (per order, integer UGX, no floating point):
--   customer pays : subtotal + delivery_fee + 15% of subtotal
--   business nets : subtotal  - 10% of subtotal
--   rider nets    : delivery   -  5% of delivery
--   platform keeps: 15% of subtotal + 10% of subtotal + 5% of delivery
-- Invariant: customer_fee + business_fee + rider_fee + merchant_payout + rider_payout
--            == escrow hold amount
--
-- All money paths are idempotent and run under SECURITY DEFINER with a pinned
-- search_path. Direct anon/authenticated access is revoked; only service_role
-- may call these functions, and RLS is enabled with no client policies.

-- ── Integer percent helper (half-up, no floats) ──────────────────────
CREATE OR REPLACE FUNCTION public.pct_of(p_amount BIGINT, p_percent INT)
RETURNS BIGINT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (p_amount * p_percent + 50) / 100;
$$;

-- ── Wallets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  available_balance BIGINT NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  escrow_balance BIGINT NOT NULL DEFAULT 0 CHECK (escrow_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Ledger entries (append-only) ─────────────────────────────────────
-- user_id is NULL for platform-level rows (commission), so the FK to
-- auth.users is never violated by a synthetic placeholder id.
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN
    ('deposit','order_hold','order_release','commission','payout','refund','adjustment')),
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  ref_type TEXT,
  ref_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Deposits ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('morse','manual')),
  provider_ref TEXT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','failed','expired','cancelled')),
  reference_code TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  confirmed_at TIMESTAMPTZ
);

-- ── Escrow holds ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.escrow_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','released','refunded')),
  customer_fee BIGINT NOT NULL DEFAULT 0,
  business_fee BIGINT NOT NULL DEFAULT 0,
  rider_fee BIGINT NOT NULL DEFAULT 0,
  merchant_payout BIGINT NOT NULL DEFAULT 0,
  rider_payout BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Payouts (what admin still owes business / rider) ─────────────────
CREATE TABLE IF NOT EXISTS public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL,
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('business','rider')),
  amount BIGINT NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, recipient_role)
);

-- ── Converge pre-existing tables ──────────────────────────────────────
-- Production already had these five tables from an earlier rollout, so the
-- CREATE TABLE IF NOT EXISTS statements above are skipped there and any
-- column/constraint added since is silently missing. Everything below is
-- idempotent and makes a partially-migrated database match this file.
ALTER TABLE public.wallets       ADD COLUMN IF NOT EXISTS escrow_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';
ALTER TABLE public.deposits      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE public.deposits      ADD COLUMN IF NOT EXISTS provider_ref TEXT;
ALTER TABLE public.deposits      ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.deposits      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.escrow_holds  ADD COLUMN IF NOT EXISTS customer_fee    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds  ADD COLUMN IF NOT EXISTS business_fee    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds  ADD COLUMN IF NOT EXISTS rider_fee       BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds  ADD COLUMN IF NOT EXISTS merchant_payout BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.escrow_holds  ADD COLUMN IF NOT EXISTS rider_payout    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.payouts       ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE public.payouts       ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UGX';

-- Backfill the one timestamp that has no safe default.
UPDATE public.deposits SET expires_at = created_at + INTERVAL '30 minutes'
 WHERE expires_at IS NULL;

-- Platform commission rows carry a NULL user_id, so an inherited NOT NULL
-- from the original rollout has to go.
ALTER TABLE public.ledger_entries ALTER COLUMN user_id DROP NOT NULL;

-- Re-assert the enumerated CHECK constraints: an older rollout allowed only a
-- subset of the values used by the current functions.
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_type_check;
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_type_check
  CHECK (type IN ('deposit','order_hold','order_release','commission','payout','refund','adjustment'));

ALTER TABLE public.deposits DROP CONSTRAINT IF EXISTS deposits_provider_check;
ALTER TABLE public.deposits ADD CONSTRAINT deposits_provider_check
  CHECK (provider IN ('morse','manual'));

ALTER TABLE public.deposits DROP CONSTRAINT IF EXISTS deposits_status_check;
ALTER TABLE public.deposits ADD CONSTRAINT deposits_status_check
  CHECK (status IN ('pending','confirmed','failed','expired','cancelled'));

ALTER TABLE public.escrow_holds DROP CONSTRAINT IF EXISTS escrow_holds_status_check;
ALTER TABLE public.escrow_holds ADD CONSTRAINT escrow_holds_status_check
  CHECK (status IN ('held','released','refunded'));

ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending','paid','cancelled'));

-- ── Order fee / payout columns ───────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS business_fee_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_fee_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS merchant_payout_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_payout_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS escrow_hold_id UUID;
-- Legacy per-role fee columns written by the pre-escrow settlement path.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_service_fee_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS business_service_fee_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS rider_service_fee_ugx BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS platform_fees_ugx BIGINT NOT NULL DEFAULT 0;

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wallets_user ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON public.ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON public.ledger_entries(type);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON public.ledger_entries(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON public.deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON public.deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_reference ON public.deposits(reference_code);
CREATE INDEX IF NOT EXISTS idx_escrow_order ON public.escrow_holds(order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON public.escrow_holds(status);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_recipient ON public.payouts(recipient_id, recipient_role);

-- ── updated_at triggers ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_wallet_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallets_updated ON public.wallets;
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_wallet_timestamp();

DROP TRIGGER IF EXISTS trg_escrow_updated ON public.escrow_holds;
CREATE TRIGGER trg_escrow_updated BEFORE UPDATE ON public.escrow_holds
  FOR EACH ROW EXECUTE FUNCTION public.update_wallet_timestamp();

-- ── confirm_deposit (idempotent, admin may override amount) ──────────
CREATE OR REPLACE FUNCTION public.confirm_deposit(
  p_deposit_id UUID,
  p_provider_tx_id TEXT DEFAULT NULL,
  p_amount_override BIGINT DEFAULT NULL,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, credited BIGINT) AS $$
DECLARE
  v_deposit public.deposits%ROWTYPE;
  v_amount BIGINT;
BEGIN
  SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Deposit not found'::TEXT, 0::BIGINT; RETURN;
  END IF;
  IF v_deposit.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, format('Deposit already %s', v_deposit.status)::TEXT, 0::BIGINT; RETURN;
  END IF;

  v_amount := COALESCE(p_amount_override, v_deposit.amount);
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Amount must be positive'::TEXT, 0::BIGINT; RETURN;
  END IF;

  UPDATE public.deposits
     SET status = 'confirmed',
         confirmed_at = now(),
         amount = v_amount,
         provider_ref = COALESCE(p_provider_tx_id, provider_ref),
         metadata = metadata || jsonb_strip_nulls(
           jsonb_build_object('admin_note', p_admin_note,
                              'override', p_amount_override IS NOT NULL,
                              'original_amount', v_deposit.amount))
   WHERE id = p_deposit_id;

  INSERT INTO public.wallets (user_id, available_balance, escrow_balance)
  VALUES (v_deposit.user_id, v_amount, 0)
  ON CONFLICT (user_id) DO UPDATE
    SET available_balance = public.wallets.available_balance + v_amount;

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (v_deposit.user_id, 'deposit', v_amount, v_deposit.currency,
          'deposit', p_deposit_id::TEXT,
          jsonb_build_object('provider', v_deposit.provider, 'override', p_amount_override IS NOT NULL));

  RETURN QUERY SELECT TRUE, 'Deposit confirmed'::TEXT, v_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ── hold_escrow (idempotent) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hold_escrow(
  p_user_id UUID,
  p_order_id UUID,
  p_amount BIGINT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_hold public.escrow_holds%ROWTYPE;
BEGIN
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Amount must be positive'::TEXT; RETURN;
  END IF;

  -- already settled for this order? (covers all duplicate-submit cases)
  SELECT * INTO v_hold FROM public.escrow_holds WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    IF v_hold.status = 'held' AND v_hold.amount = p_amount THEN
      RETURN QUERY SELECT TRUE, 'Escrow already held for this order'::TEXT; RETURN;
    ELSIF v_hold.status <> 'held' THEN
      RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT; RETURN;
    END IF;
  END IF;

  INSERT INTO public.wallets (user_id, available_balance, escrow_balance)
  VALUES (p_user_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF v_wallet.available_balance < p_amount THEN
    RETURN QUERY SELECT FALSE,
      format('Insufficient balance: have %s, need %s', v_wallet.available_balance, p_amount)::TEXT;
    RETURN;
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance - p_amount,
         escrow_balance    = escrow_balance + p_amount
   WHERE user_id = p_user_id;

  INSERT INTO public.escrow_holds (order_id, amount, status) VALUES (p_order_id, p_amount, 'held');

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id, 'order_hold', p_amount, 'UGX', 'order', p_order_id::TEXT, '{}'::jsonb);

  RETURN QUERY SELECT TRUE, 'Escrow held'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ── release_escrow (15% customer / 10% business / 5% rider) ─────────
CREATE OR REPLACE FUNCTION public.release_escrow(
  p_order_id UUID,
  p_customer_fee_percent INT DEFAULT 15,
  p_business_fee_percent INT DEFAULT 10,
  p_rider_fee_percent INT DEFAULT 5
)
RETURNS TABLE(
  success BOOLEAN, message TEXT,
  customer_fee BIGINT, business_fee BIGINT, rider_fee BIGINT,
  merchant_payout BIGINT, rider_payout BIGINT
) AS $$
DECLARE
  v_hold public.escrow_holds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_subtotal BIGINT;
  v_delivery BIGINT;
  v_customer_fee BIGINT;
  v_business_fee BIGINT;
  v_rider_fee BIGINT;
  v_merchant_payout BIGINT;
  v_rider_payout BIGINT;
  v_expected BIGINT;
  v_business_user UUID;
BEGIN
  SELECT * INTO v_hold FROM public.escrow_holds WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT, 0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT; RETURN;
  END IF;
  IF v_hold.status <> 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT, 0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT; RETURN;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Order not found'::TEXT, 0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT; RETURN;
  END IF;

  v_subtotal := COALESCE(v_order.subtotal_ugx, 0);
  v_delivery := COALESCE(v_order.delivery_fee_ugx, 0);

  v_customer_fee      := public.pct_of(v_subtotal, p_customer_fee_percent);
  v_business_fee      := public.pct_of(v_subtotal, p_business_fee_percent);
  v_rider_fee         := public.pct_of(v_delivery, p_rider_fee_percent);
  v_merchant_payout   := GREATEST(v_subtotal - v_business_fee, 0);
  v_rider_payout      := GREATEST(v_delivery - v_rider_fee, 0);

  v_expected := v_subtotal + v_delivery + v_customer_fee;
  IF v_hold.amount <> v_expected THEN
    RETURN QUERY SELECT FALSE,
      format('Hold %s does not match order total %s (subtotal %s + delivery %s + fee %s)',
             v_hold.amount, v_expected, v_subtotal, v_delivery, v_customer_fee)::TEXT,
      0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT,0::BIGINT;
    RETURN;
  END IF;

  UPDATE public.escrow_holds
     SET status = 'released', updated_at = now(),
         customer_fee = v_customer_fee, business_fee = v_business_fee, rider_fee = v_rider_fee,
         merchant_payout = v_merchant_payout, rider_payout = v_rider_payout
   WHERE id = v_hold.id;

  UPDATE public.wallets SET escrow_balance = escrow_balance - v_hold.amount
   WHERE user_id = v_order.customer_id;

  -- platform fees (user_id NULL -> no auth.users FK violation)
  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta) VALUES
    (NULL, 'commission', v_customer_fee, 'UGX', 'order', p_order_id::TEXT,
      jsonb_build_object('component','customer_service_fee','percent',p_customer_fee_percent)),
    (NULL, 'commission', v_business_fee, 'UGX', 'order', p_order_id::TEXT,
      jsonb_build_object('component','business_fee','percent',p_business_fee_percent)),
    (NULL, 'commission', v_rider_fee, 'UGX', 'order', p_order_id::TEXT,
      jsonb_build_object('component','rider_fee','percent',p_rider_fee_percent));

  -- business payout. payouts.recipient_id is the MERCHANT id; the ledger must
  -- reference the merchant's auth user (merchants.owner_id) to satisfy the FK.
  IF v_order.merchant_id IS NOT NULL AND v_merchant_payout > 0 THEN
    SELECT owner_id INTO v_business_user FROM public.merchants WHERE id = v_order.merchant_id;

    INSERT INTO public.payouts (order_id, recipient_id, recipient_role, amount, currency, status)
    VALUES (p_order_id, v_order.merchant_id, 'business', v_merchant_payout, 'UGX', 'pending')
    ON CONFLICT (order_id, recipient_role) DO NOTHING;

    IF v_business_user IS NOT NULL THEN
      INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
      VALUES (v_business_user, 'payout', v_merchant_payout, 'UGX', 'order', p_order_id::TEXT,
              jsonb_build_object('role','business','fee',v_business_fee,'merchant_id',v_order.merchant_id));
    END IF;
  END IF;

  -- rider payout
  IF v_order.rider_id IS NOT NULL AND v_rider_payout > 0 THEN
    INSERT INTO public.payouts (order_id, recipient_id, recipient_role, amount, currency, status)
    VALUES (p_order_id, v_order.rider_id, 'rider', v_rider_payout, 'UGX', 'pending')
    ON CONFLICT (order_id, recipient_role) DO NOTHING;

    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_order.rider_id, 'payout', v_rider_payout, 'UGX', 'order', p_order_id::TEXT,
            jsonb_build_object('role','rider','fee',v_rider_fee));
  END IF;

  UPDATE public.orders
     SET business_fee_ugx   = v_business_fee,
         rider_fee_ugx      = v_rider_fee,
         merchant_payout_ugx= v_merchant_payout,
         rider_payout_ugx   = v_rider_payout,
         escrow_hold_id     = v_hold.id,
         payment_status     = 'settled',
         updated_at         = now()
   WHERE id = p_order_id;

  RETURN QUERY SELECT TRUE, 'Escrow released'::TEXT,
    v_customer_fee, v_business_fee, v_rider_fee, v_merchant_payout, v_rider_payout;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ── mark_payout_paid (admin gives out money, credits wallet) ──────────
CREATE OR REPLACE FUNCTION public.mark_payout_paid(
  p_payout_id UUID,
  p_reference TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_payout public.payouts%ROWTYPE;
  v_recipient UUID;
BEGIN
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Payout not found'::TEXT; RETURN;
  END IF;
  IF v_payout.status <> 'pending' THEN
    RETURN QUERY SELECT FALSE, format('Payout already %s', v_payout.status)::TEXT; RETURN;
  END IF;

  -- recipient_id is merchants.id for business (resolve to owner_id), and the
  -- auth user id itself for riders (riders.id IS the auth.users id).
  v_recipient := CASE WHEN v_payout.recipient_role = 'business'
                      THEN (SELECT owner_id FROM public.merchants WHERE id = v_payout.recipient_id)
                      ELSE v_payout.recipient_id
                   END;

  UPDATE public.payouts SET status = 'paid', paid_at = now() WHERE id = p_payout_id;

  IF v_recipient IS NOT NULL AND v_payout.amount > 0 THEN
    INSERT INTO public.wallets (user_id, available_balance, escrow_balance)
    VALUES (v_recipient, v_payout.amount, 0)
    ON CONFLICT (user_id) DO UPDATE
      SET available_balance = public.wallets.available_balance + v_payout.amount;

    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_recipient, 'adjustment', v_payout.amount, v_payout.currency, 'payout', p_payout_id::TEXT,
            jsonb_build_object('role', v_payout.recipient_role, 'reference', p_reference));
  END IF;

  RETURN QUERY SELECT TRUE, 'Payout marked paid'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ── refund_escrow (idempotent) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_escrow(p_order_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_hold public.escrow_holds%ROWTYPE;
  v_customer_id UUID;
BEGIN
  SELECT * INTO v_hold FROM public.escrow_holds WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT; RETURN;
  END IF;
  IF v_hold.status <> 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT; RETURN;
  END IF;

  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = p_order_id;

  UPDATE public.escrow_holds SET status = 'refunded', updated_at = now() WHERE id = v_hold.id;
  UPDATE public.payouts SET status = 'cancelled'
   WHERE order_id = p_order_id AND status = 'pending';

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.wallets
       SET escrow_balance    = escrow_balance - v_hold.amount,
           available_balance = available_balance + v_hold.amount
     WHERE user_id = v_customer_id;

    INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
    VALUES (v_customer_id, 'refund', v_hold.amount, 'UGX', 'order', p_order_id::TEXT, '{}'::jsonb);
  END IF;

  UPDATE public.orders SET payment_status = 'refunded', updated_at = now() WHERE id = p_order_id;

  RETURN QUERY SELECT TRUE, 'Escrow refunded'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- ── expire stale pending deposits ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_stale_deposits()
RETURNS TABLE(expired_count INT) AS $$
DECLARE n INT;
BEGIN
  UPDATE public.deposits SET status = 'expired'
   WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Security: service_role only ──────────────────────────────────────
ALTER TABLE public.wallets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_holds  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallets, public.ledger_entries, public.deposits,
              public.escrow_holds, public.payouts FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.pct_of(BIGINT,INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_deposit(UUID,TEXT,BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hold_escrow(UUID,UUID,BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_escrow(UUID,INT,INT,INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_payout_paid(UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_escrow(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_deposits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_wallet_timestamp() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pct_of(BIGINT,INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_deposit(UUID,TEXT,BIGINT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.hold_escrow(UUID,UUID,BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_escrow(UUID,INT,INT,INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payout_paid(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_escrow(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_deposits() TO service_role;
