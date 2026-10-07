-- ============================================================================
-- SCHEMA_LEDGER_CONVERGENCE.sql
--
-- Follow-up to SCHEMA_RECONCILIATION.sql.
--
-- SCHEMA_RECONCILIATION created the canonical money model (wallets +
-- ledger_entries + deposits) but the application still ran a second, parallel
-- implementation in src/lib/wallet-store.ts against two tables that never
-- existed (`wallet_ledger`, `topup_requests`). That is why an approved deposit
-- was never credited and never appeared in history: the customer wrote to one
-- ledger and the admin credited the other.
--
-- This file closes the two gaps that remain in the canonical model itself:
--
--   1. `wallets` holds a single UGX balance, but the legacy store tracks a USDT
--      balance too (Morse/P2P USDT top-ups and USDT gas-fee spend). Every
--      mutation must therefore be currency-aware, not UGX-only.
--   2. confirm_deposit() credited `wallets.available_balance` regardless of the
--      deposit's currency, so a USDT deposit would inflate the UGX balance.
--
-- Every balance change still goes through a SECURITY DEFINER function, so the
-- ledger is append-only and auditable and the API role still never needs DDL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. USDT balance is the sum of its ledger entries.
--
-- There is no separate `wallets` row per currency, so the running USDT balance
-- is derived. Both the credit and debit paths below are the only writers, so
-- the sum stays correct under normal operation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usdt_balance(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)::BIGINT
    FROM public.ledger_entries
   WHERE user_id = p_user_id AND currency = 'USDT';
$$;

-- ---------------------------------------------------------------------------
-- 2. Currency-aware credit. UGX updates the wallet row and appends the ledger
--    entry; USDT only appends the ledger entry (its balance IS the ledger).
--
-- Idempotency: a p_reference that already exists for this user and currency is
-- NOT replayed, so a retried webhook or double-clicked admin button cannot mint
-- a second credit. This is the property the old wallet_ledger path did not have.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet_currency(
  p_user_id UUID,
  p_amount BIGINT,
  p_currency TEXT DEFAULT 'UGX',
  p_reference TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(success BOOLEAN, message TEXT, balance BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_currency TEXT := CASE WHEN UPPER(COALESCE(p_currency,'UGX')) = 'USDT' THEN 'USDT' ELSE 'UGX' END;
  v_balance  BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  -- Reject a replay of a reference we have already posted for this user.
  IF p_reference IS NOT NULL AND p_reference <> '' AND EXISTS (
    SELECT 1 FROM public.ledger_entries
     WHERE user_id = p_user_id
       AND currency = v_currency
       AND ref_id   = p_reference
       AND amount   = p_amount
  ) THEN
    IF v_currency = 'USDT' THEN
      SELECT public.usdt_balance(p_user_id) INTO v_balance;
    ELSE
      SELECT COALESCE(available_balance, 0) INTO v_balance
        FROM public.wallets WHERE user_id = p_user_id;
    END IF;
    RETURN QUERY SELECT TRUE, 'Already credited'::TEXT, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  IF v_currency = 'UGX' THEN
    INSERT INTO public.wallets (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets
       SET available_balance = available_balance + p_amount, updated_at = now()
     WHERE user_id = p_user_id
    RETURNING wallets.available_balance INTO v_balance;
  ELSE
    v_balance := public.usdt_balance(p_user_id) + p_amount;
  END IF;

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id,
          CASE WHEN v_currency = 'USDT' THEN 'topup' ELSE 'deposit' END,
          p_amount, v_currency,
          'manual', COALESCE(p_reference, ''),
          COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('note', COALESCE(p_note, '')));

  RETURN QUERY SELECT TRUE, 'Credited'::TEXT, COALESCE(v_balance, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Currency-aware debit. The balance guard lives in the WHERE clause so two
--    concurrent spends cannot both succeed against the same balance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_wallet_currency(
  p_user_id UUID,
  p_amount BIGINT,
  p_currency TEXT DEFAULT 'UGX',
  p_reference TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, balance BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_currency TEXT := CASE WHEN UPPER(COALESCE(p_currency,'UGX')) = 'USDT' THEN 'USDT' ELSE 'UGX' END;
  v_balance  BIGINT;
  v_before   BIGINT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, 'Invalid amount'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  IF v_currency = 'UGX' THEN
    INSERT INTO public.wallets (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets
       SET available_balance = available_balance - p_amount, updated_at = now()
     WHERE user_id = p_user_id AND available_balance >= p_amount
    RETURNING wallets.available_balance INTO v_balance;

    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, 'Insufficient wallet balance'::TEXT, 0::BIGINT;
      RETURN;
    END IF;
  ELSE
    v_before := public.usdt_balance(p_user_id);
    IF v_before < p_amount THEN
      RETURN QUERY SELECT FALSE, 'Insufficient wallet balance'::TEXT, v_before;
      RETURN;
    END IF;
    v_balance := v_before - p_amount;
  END IF;

  INSERT INTO public.ledger_entries (user_id, type, amount, currency, ref_type, ref_id, meta)
  VALUES (p_user_id, 'payment', -p_amount, v_currency,
          'manual', COALESCE(p_reference, ''),
          jsonb_build_object('note', COALESCE(p_note, '')));

  RETURN QUERY SELECT TRUE, 'Debited'::TEXT, v_balance;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. confirm_deposit must credit the right currency. A USDT deposit is a
--    ledger-only credit; a UGX deposit moves the wallet row. Both are appended
--    to ledger_entries so history shows the deposit either way.
--
--    Re-pointing at credit_wallet_currency keeps a single audited write path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_deposit(p_deposit_id UUID, p_provider_tx_id TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deposit RECORD;
  v_result  RECORD;
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

  SELECT * INTO v_result
    FROM public.credit_wallet_currency(
           v_deposit.user_id,
           v_deposit.amount,
           v_deposit.currency,
           v_deposit.reference_code,
           'Deposit ' || v_deposit.reference_code,
           jsonb_build_object('provider', v_deposit.provider, 'deposit_id', p_deposit_id::TEXT)
         ) AS t(success, message, balance);

  IF NOT v_result.success THEN
    RETURN QUERY SELECT FALSE, v_result.message;
    RETURN;
  END IF;

  UPDATE public.deposits
     SET status          = 'confirmed',
         confirmed_at    = now(),
         credited_wallet = true,
         credited_at     = now(),
         provider_ref    = COALESCE(p_provider_tx_id, provider_ref)
   WHERE id = p_deposit_id;

  RETURN QUERY SELECT TRUE, 'Deposit confirmed'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Diagnostic the admin live-ops check reads. It previously 404'd, so the
--    realtime check always reported an empty publication and hid real breakage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.realtime_publication_tables()
RETURNS TABLE(publication TEXT, tablename TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.pubname::TEXT, c.relname::TEXT
    FROM pg_publication p
    JOIN pg_publication_rel pr ON pr.prpubid = p.oid
    JOIN pg_class c           ON c.oid = pr.prrelid
   WHERE p.pubname = 'supabase_realtime'
   ORDER BY c.relname;
$$;

-- ---------------------------------------------------------------------------
-- 6. Backfill: any profile that never got a wallet row (created before the
--    handle_new_user trigger existed) gets one, so the wallet page can never
--    render an endless loading state for an existing account.
-- ---------------------------------------------------------------------------
INSERT INTO public.wallets (user_id)
SELECT p.id FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id = p.id)
ON CONFLICT (user_id) DO NOTHING;
-- ---------------------------------------------------------------------------
-- 7. Attach a payment-proof screenshot without clobbering the metadata the
--    customer submitted alongside the request (phone, network, their name).
--    A plain `update { metadata }` from the app would silently drop those.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_deposit_screenshot(p_deposit_id UUID, p_screenshot_url TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.deposits
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('screenshot_url', p_screenshot_url)
   WHERE id = p_deposit_id
  RETURNING TRUE;
$$;
