-- fix-chat-rls.sql
-- Closes the "RLS Disabled in Public" lint finding for public.chat_messages.
--
-- The repo's schema.sql and rls_hardening.sql both contain the correct DDL, but
-- neither was ever applied to the live Supabase project, so the table is still
-- publicly readable/writable with RLS off.
--
-- This migration:
--   1. Enables RLS on chat_messages (idempotent).
--   2. Drops every existing policy on chat_messages (old "Public read/insert" ones
--      if they were applied by schema.sql, or nothing if they were not).
--   3. Creates participant-scoped policies: a row is visible / insertable only by
--      someone involved in the linked order (customer, merchant owner, assigned
--      rider).  No anonymous access.  Casts with ::text because live columns are
--      polymorphic (merchant_id is UUID on some tables, text on others).
--
-- Apply via: node scripts/apply-sql.mjs scripts/fix-chat-rls.sql

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies so this is re-runnable.
DROP POLICY IF EXISTS "Public read chat" ON chat_messages;
DROP POLICY IF EXISTS "Public insert chat" ON chat_messages;
DROP POLICY IF EXISTS "gd_chat_select" ON chat_messages;
DROP POLICY IF EXISTS "gd_chat_insert" ON chat_messages;

-- Participant-scoped SELECT: only someone involved in the linked order may read.
CREATE POLICY "gd_chat_select"
  ON chat_messages FOR SELECT USING (
    order_id::text IN (
      SELECT id::text FROM orders
      WHERE customer_id::text = auth.uid()::text
         OR customer_email = (auth.jwt() ->> 'email')
         OR rider_id::text = auth.uid()::text
         OR merchant_id::text IN (
           SELECT id::text FROM merchants
           WHERE owner_id::text = auth.uid()::text
         )
    )
  );

-- Participant-scoped INSERT: same scope — you can only chat on an order you own.
CREATE POLICY "gd_chat_insert"
  ON chat_messages FOR INSERT WITH CHECK (
    order_id::text IN (
      SELECT id::text FROM orders
      WHERE customer_id::text = auth.uid()::text
         OR customer_email = (auth.jwt() ->> 'email')
         OR rider_id::text = auth.uid()::text
         OR merchant_id::text IN (
           SELECT id::text FROM merchants
           WHERE owner_id::text = auth.uid()::text
         )
    )
  );