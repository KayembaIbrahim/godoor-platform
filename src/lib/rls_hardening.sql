-- rls_hardening.sql
-- Closes the open RLS policies that made the entire public schema readable and
-- writable by anonymous users (confirmed live: anon UPDATE on `riders` and
-- `merchants`, anon SELECT on every table including verification_documents and
-- rider_locations).
--
-- Strategy:
--   * Drop EVERY existing policy on the managed tables (they are all open).
--   * Re-create selective policies:
--       - Public stores: catalog reads for active merchants / available products.
--       - Participants only: orders, payments, chat, disputes.
--       - Owner only: writes on merchants, products, catalogues, stories,
--         verification_documents, riders, rider_locations.
--       - Role-gated dispatch: riders may read unassigned order listings.
--   * Storage: verification bucket locked to the owner (contains ID photos);
--     uploads to all buckets restricted to authenticated users.
--
-- Apply by sending the whole file as the `query` argument to exec_sql once.
-- (exec_sql is a SECURITY DEFINER void function run under the service role.)

DO $do$
DECLARE r record;
BEGIN
  -- 1) Remove every existing policy from the managed public tables.
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'riders','orders','merchants','products','payments','chat_messages',
        'disputes','stories','followers','verification_documents',
        'rider_locations','catalogues','fee_config','admin_settings'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;

  -- 2) Remove every existing storage.objects policy so they can be made strict.
  FOR r IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;

  -- 3) Sensitive API-created tables: ensure RLS is ON with zero policies (deny all except service role).
  BEGIN
    ALTER TABLE phone_change_requests ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN
    ALTER TABLE partner_requests ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN
    ALTER TABLE business_name_requests ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN
    ALTER TABLE morse_tag_change_requests ENABLE ROW LEVEL SECURITY;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ── merchants ─────────────────────────────────────────────
  -- Public: active listings only. Own: anything you own (even pending/suspended).
  EXECUTE $p$ CREATE POLICY "gd_merchants_select" ON merchants FOR SELECT USING (status = 'active' OR owner_id::text = auth.uid()::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_merchants_insert" ON merchants FOR INSERT WITH CHECK (owner_id::text = auth.uid()::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_merchants_update" ON merchants FOR UPDATE USING (owner_id::text = auth.uid()::text) WITH CHECK (owner_id::text = auth.uid()::text) $p$;

  -- ── products ──────────────────────────────────────────────
  -- Public: whole menu is a storefront. Writes: parent merchant owner only.
  EXECUTE $p$ CREATE POLICY "gd_products_select" ON products FOR SELECT USING (true) $p$;
  EXECUTE $p$ CREATE POLICY "gd_products_insert" ON products FOR INSERT WITH CHECK (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_products_update" ON products FOR UPDATE USING (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) WITH CHECK (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_products_delete" ON products FOR DELETE USING (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;

  -- ── catalogues ────────────────────────────────────────────
  EXECUTE $p$ CREATE POLICY "gd_catalogues_select" ON catalogues FOR SELECT USING (true) $p$;
  EXECUTE $p$ CREATE POLICY "gd_catalogues_insert" ON catalogues FOR INSERT WITH CHECK (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_catalogues_update" ON catalogues FOR UPDATE USING (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) WITH CHECK (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_catalogues_delete" ON catalogues FOR DELETE USING (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;

  -- ── orders ────────────────────────────────────────────────
  -- Participants (customer / merchant owner / assigned rider) may read & update.
  -- Riders additionally see unassigned orders in dispatchable states.
  EXECUTE $p$ CREATE POLICY "gd_orders_select" ON orders FOR SELECT USING (
    auth.uid() IS NOT NULL AND (
      customer_id::text = auth.uid()::text
      OR customer_email = (auth.jwt() ->> 'email')
      OR rider_id::text = auth.uid()::text
      OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)
      OR (
        rider_id IS NULL
        AND (auth.jwt() ->> 'role') = 'rider'
        AND status IN ('payment_submitted','payment_confirmed','preparing','ready')
      )
    )
  ) $p$;
  EXECUTE $p$ CREATE POLICY "gd_orders_update" ON orders FOR UPDATE USING (
    customer_id::text = auth.uid()::text
    OR rider_id::text = auth.uid()::text
    OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)
  ) $p$;

  -- ── payments / chat / disputes ────────────────────────────
  -- Readable by anyone involved in the linked order. No anon visibility.
  EXECUTE $p$ CREATE POLICY "gd_payments_select" ON payments FOR SELECT USING (
    order_id::text IN (SELECT id::text FROM orders WHERE customer_id::text = auth.uid()::text OR customer_email = (auth.jwt() ->> 'email') OR rider_id::text = auth.uid()::text OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text))
  ) $p$;

  EXECUTE $p$ CREATE POLICY "gd_chat_select" ON chat_messages FOR SELECT USING (
    order_id::text IN (SELECT id::text FROM orders WHERE customer_id::text = auth.uid()::text OR customer_email = (auth.jwt() ->> 'email') OR rider_id::text = auth.uid()::text OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text))
  ) $p$;
  EXECUTE $p$ CREATE POLICY "gd_chat_insert" ON chat_messages FOR INSERT WITH CHECK (
    order_id::text IN (SELECT id::text FROM orders WHERE customer_id::text = auth.uid()::text OR customer_email = (auth.jwt() ->> 'email') OR rider_id::text = auth.uid()::text OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text))
  ) $p$;

  EXECUTE $p$ CREATE POLICY "gd_disputes_select" ON disputes FOR SELECT USING (
    order_id::text IN (SELECT id::text FROM orders WHERE customer_id::text = auth.uid()::text OR customer_email = (auth.jwt() ->> 'email') OR rider_id::text = auth.uid()::text OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text))
  ) $p$;
  EXECUTE $p$ CREATE POLICY "gd_disputes_insert" ON disputes FOR INSERT WITH CHECK (
    order_id::text IN (SELECT id::text FROM orders WHERE customer_id::text = auth.uid()::text OR customer_email = (auth.jwt() ->> 'email') OR rider_id::text = auth.uid()::text OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text))
  ) $p$;
  EXECUTE $p$ CREATE POLICY "gd_disputes_update" ON disputes FOR UPDATE USING (
    order_id::text IN (SELECT id::text FROM orders WHERE customer_id::text = auth.uid()::text OR customer_email = (auth.jwt() ->> 'email') OR rider_id::text = auth.uid()::text OR merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text))
  ) $p$;

  -- ── stories ───────────────────────────────────────────────
  EXECUTE $p$ CREATE POLICY "gd_stories_select" ON stories FOR SELECT USING (true) $p$;
  EXECUTE $p$ CREATE POLICY "gd_stories_insert" ON stories FOR INSERT WITH CHECK (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_stories_delete" ON stories FOR DELETE USING (merchant_id::text IN (SELECT id::text FROM merchants WHERE owner_id::text = auth.uid()::text)) $p$;

  -- ── followers ─────────────────────────────────────────────
  EXECUTE $p$ CREATE POLICY "gd_followers_select" ON followers FOR SELECT USING (true) $p$;
  EXECUTE $p$ CREATE POLICY "gd_followers_insert" ON followers FOR INSERT WITH CHECK (customer_id::text = auth.uid()::text::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_followers_delete" ON followers FOR DELETE USING (customer_id::text = auth.uid()::text::text) $p$;

  -- ── verification_documents (contains ID photos/PII) ──────
  EXECUTE $p$ CREATE POLICY "gd_vdocs_select" ON verification_documents FOR SELECT USING (user_id::text = auth.uid()::text::text OR (auth.jwt() ->> 'role') = 'admin') $p$;
  EXECUTE $p$ CREATE POLICY "gd_vdocs_insert" ON verification_documents FOR INSERT WITH CHECK (user_id::text = auth.uid()::text::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_vdocs_update" ON verification_documents FOR UPDATE USING ((auth.jwt() ->> 'role') = 'admin') $p$;

  -- ── riders ────────────────────────────────────────────────
  EXECUTE $p$ CREATE POLICY "gd_riders_select" ON riders FOR SELECT USING (auth.uid() IS NOT NULL) $p$;
  EXECUTE $p$ CREATE POLICY "gd_riders_insert" ON riders FOR INSERT WITH CHECK (id::text = auth.uid()::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_riders_update" ON riders FOR UPDATE USING (id::text = auth.uid()::text) $p$;

  -- ── rider_locations (precise GPS) ────────────────────────
  EXECUTE $p$ CREATE POLICY "gd_rider_locations_select" ON rider_locations FOR SELECT USING (auth.uid() IS NOT NULL) $p$;
  EXECUTE $p$ CREATE POLICY "gd_rider_locations_insert" ON rider_locations FOR INSERT WITH CHECK (rider_id::text = auth.uid()::text::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_rider_locations_update" ON rider_locations FOR UPDATE USING (rider_id::text = auth.uid()::text::text) $p$;

  -- ── fee_config ────────────────────────────────────────────
  EXECUTE $p$ CREATE POLICY "gd_fees_select" ON fee_config FOR SELECT USING (true) $p$;

  -- ── storage.objects ───────────────────────────────────────
  -- Product imagery stays public to read; only authenticated users may upload.
  EXECUTE $p$ CREATE POLICY "gd_sp_read" ON storage.objects FOR SELECT USING (bucket_id = 'store-photos') $p$;
  EXECUTE $p$ CREATE POLICY "gd_sp_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'store-photos' AND auth.role() = 'authenticated') $p$;
  EXECUTE $p$ CREATE POLICY "gd_pi_read" ON storage.objects FOR SELECT USING (bucket_id = 'product-images') $p$;
  EXECUTE $p$ CREATE POLICY "gd_pi_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated') $p$;
  EXECUTE $p$ CREATE POLICY "gd_cat_read" ON storage.objects FOR SELECT USING (bucket_id = 'catalogue-images') $p$;
  EXECUTE $p$ CREATE POLICY "gd_cat_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'catalogue-images' AND auth.role() = 'authenticated') $p$;
  EXECUTE $p$ CREATE POLICY "gd_stories_read" ON storage.objects FOR SELECT USING (bucket_id = 'stories') $p$;
  EXECUTE $p$ CREATE POLICY "gd_stories_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'stories' AND auth.role() = 'authenticated') $p$;
  EXECUTE $p$ CREATE POLICY "gd_av_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars') $p$;
  EXECUTE $p$ CREATE POLICY "gd_av_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated') $p$;
  -- verification bucket is private: only the document owner (or admin via service role) may read; only the owner may upload.
  EXECUTE $p$ CREATE POLICY "gd_verif_read" ON storage.objects FOR SELECT USING (bucket_id = 'verification' AND (storage.foldername(name))[2] = auth.uid()::text) $p$;
  EXECUTE $p$ CREATE POLICY "gd_verif_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'verification' AND auth.role() = 'authenticated' AND (storage.foldername(name))[2] = auth.uid()::text) $p$;

  RAISE NOTICE 'RLS hardening applied';
END $do$;