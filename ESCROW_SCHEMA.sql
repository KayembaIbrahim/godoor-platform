-- GoDoor Escrow & Wallet Schema
-- Run this in the Supabase SQL editor.

-- ── Wallets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  available_balance BIGINT NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  escrow_balance BIGINT NOT NULL DEFAULT 0 CHECK (escrow_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Ledger entries (immutable) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit','order_hold','order_release','commission','rider_payout','refund')),
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UGX',
  ref_type TEXT,
  ref_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Deposits ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('morse','momo','blipply','manual')),
  provider_ref TEXT,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','expired','cancelled')),
  reference_code TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

-- ── Escrow holds ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','released','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_entries(type);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_deposits_reference ON deposits(reference_code);
CREATE INDEX IF NOT EXISTS idx_escrow_order ON escrow_holds(order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_holds(status);

-- ── Trigger: keep wallets.updated_at fresh ──────────────────────────
CREATE OR REPLACE FUNCTION update_wallet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallets_updated ON wallets;
CREATE TRIGGER trg_wallets_updated
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_wallet_timestamp();

-- ── Trigger: keep escrow_holds.updated_at fresh ──────────────────────
DROP TRIGGER IF EXISTS trg_escrow_updated ON escrow_holds;
CREATE TRIGGER trg_escrow_updated
  BEFORE UPDATE ON escrow_holds
  FOR EACH ROW EXECUTE FUNCTION update_wallet_timestamp();

-- ── Function: confirm deposit (idempotent) ──────────────────────────
CREATE OR REPLACE FUNCTION confirm_deposit(
  p_deposit_id UUID,
  p_provider_tx_id TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_deposit RECORD;
  v_wallet RECORD;
BEGIN
  -- Lock the deposit row
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Deposit not found'::TEXT;
    RETURN;
  END IF;

  IF v_deposit.status != 'pending' THEN
    RETURN QUERY SELECT FALSE, format('Deposit already %s', v_deposit.status)::TEXT;
    RETURN;
  END IF;

  -- Update deposit
  UPDATE deposits
    SET status = 'confirmed',
        confirmed_at = now(),
        provider_ref = COALESCE(p_provider_tx_id, provider_ref)
    WHERE id = p_deposit_id;

  -- Upsert wallet
  INSERT INTO wallets (user_id, available_balance, escrow_balance)
  VALUES (v_deposit.user_id, v_deposit.amount, 0)
  ON CONFLICT (user_id)
  DO UPDATE SET available_balance = wallets.available_balance + v_deposit.amount;

  -- Ledger entry
  INSERT INTO ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (v_deposit.user_id, 'deposit', v_deposit.amount, v_deposit.currency, 'deposit', p_deposit_id::TEXT, jsonb_build_object('provider', v_deposit.provider));

  RETURN QUERY SELECT TRUE, 'Deposit confirmed'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Function: hold escrow for an order (idempotent) ─────────────────
CREATE OR REPLACE FUNCTION hold_escrow(
  p_user_id UUID,
  p_order_id UUID,
  p_amount BIGINT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_wallet RECORD;
BEGIN
  -- Lock wallet
  SELECT * INTO v_wallet FROM wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Wallet not found'::TEXT;
    RETURN;
  END IF;

  IF v_wallet.available_balance < p_amount THEN
    RETURN QUERY SELECT FALSE, format('Insufficient balance: have %s, need %s', v_wallet.available_balance, p_amount)::TEXT;
    RETURN;
  END IF;

  -- Check for existing hold (idempotency)
  IF EXISTS (SELECT 1 FROM escrow_holds WHERE order_id = p_order_id AND status = 'held') THEN
    RETURN QUERY SELECT TRUE, 'Escrow already held for this order'::TEXT;
    RETURN;
  END IF;

  -- Move balance
  UPDATE wallets
    SET available_balance = available_balance - p_amount,
        escrow_balance = escrow_balance + p_amount
    WHERE user_id = p_user_id;

  -- Create hold
  INSERT INTO escrow_holds (order_id, amount, status)
  VALUES (p_order_id, p_amount, 'held');

  -- Ledger entry
  INSERT INTO ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id, 'order_hold', p_amount, 'UGX', 'order', p_order_id::TEXT, '{}');

  RETURN QUERY SELECT TRUE, 'Escrow held'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Function: release escrow on delivery ────────────────────────────
CREATE OR REPLACE FUNCTION release_escrow(
  p_order_id UUID,
  p_commission_percent INT DEFAULT 20
)
RETURNS TABLE(success BOOLEAN, message TEXT, commission BIGINT, rider_payout BIGINT) AS $$
DECLARE
  v_hold RECORD;
  v_commission BIGINT;
  v_rider_payout BIGINT;
BEGIN
  -- Lock hold
  SELECT * INTO v_hold FROM escrow_holds WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  IF v_hold.status != 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  v_commission := ROUND(v_hold.amount * p_commission_percent / 100.0);
  v_rider_payout := v_hold.amount - v_commission;

  -- Release hold
  UPDATE escrow_holds SET status = 'released', updated_at = now() WHERE id = v_hold.id;

  -- Debit escrow from customer wallet
  UPDATE wallets SET escrow_balance = escrow_balance - v_hold.amount WHERE user_id = (SELECT customer_id FROM orders WHERE id = p_order_id);

  -- Ledger: commission
  INSERT INTO ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES ('00000000-0000-0000-0000-000000000000', 'commission', v_commission, 'UGX', 'order', p_order_id::TEXT, jsonb_build_object('percent', p_commission_percent));

  -- Ledger: rider payout
  INSERT INTO ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES ('00000000-0000-0000-0000-000000000000', 'rider_payout', v_rider_payout, 'UGX', 'order', p_order_id::TEXT, jsonb_build_object('order_id', p_order_id::TEXT));

  RETURN QUERY SELECT TRUE, 'Escrow released'::TEXT, v_commission, v_rider_payout;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Function: refund escrow on cancel ───────────────────────────────
CREATE OR REPLACE FUNCTION refund_escrow(
  p_order_id UUID
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_hold RECORD;
  v_customer_id UUID;
BEGIN
  SELECT * INTO v_hold FROM escrow_holds WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'No escrow hold for this order'::TEXT;
    RETURN;
  END IF;

  IF v_hold.status != 'held' THEN
    RETURN QUERY SELECT FALSE, format('Escrow already %s', v_hold.status)::TEXT;
    RETURN;
  END IF;

  SELECT customer_id INTO v_customer_id FROM orders WHERE id = p_order_id;

  -- Refund hold
  UPDATE escrow_holds SET status = 'refunded', updated_at = now() WHERE id = v_hold.id;

  -- Return balance to customer
  UPDATE wallets
    SET escrow_balance = escrow_balance - v_hold.amount,
        available_balance = available_balance + v_hold.amount
    WHERE user_id = v_customer_id;

  -- Ledger entry
  INSERT INTO ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (v_customer_id, 'refund', v_hold.amount, 'UGX', 'order', p_order_id::TEXT, '{}');

  RETURN QUERY SELECT TRUE, 'Escrow refunded'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
