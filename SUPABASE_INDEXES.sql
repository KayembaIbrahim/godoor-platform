-- ============================================================
-- GoDoor — Performance Index Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Safe to re-run (all statements use IF NOT EXISTS)
-- ============================================================

-- Composite indexes for dashboard queries
-- Business dashboard: "my merchant's orders" + status filters
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_created ON orders(merchant_id, created_at DESC);

-- Rider dashboard: "my active delivery" lookups
CREATE INDEX IF NOT EXISTS idx_orders_rider_status ON orders(rider_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_rider_created ON orders(rider_id, created_at DESC);

-- Customer order history
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);

-- Available deliveries for riders (filters unassigned + status ready-to-accept)
CREATE INDEX IF NOT EXISTS idx_orders_status_unassigned ON orders(status) WHERE rider_id IS NULL;

-- Payments: per-order status lookups
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments(order_id, status);

-- Merchants: popular browsing filters
CREATE INDEX IF NOT EXISTS idx_merchants_status_category ON merchants(status, category);

-- Products: menu listing per merchant
CREATE INDEX IF NOT EXISTS idx_products_merchant_available ON products(merchant_id, is_available, sort_order);

-- Chat: message history per order (fast back-read)
CREATE INDEX IF NOT EXISTS idx_chat_order_created ON chat_messages(order_id, created_at);

-- Rider location: frequent GPS upserts keyed by rider
CREATE INDEX IF NOT EXISTS idx_rider_locs_updated ON rider_locations(updated_at DESC);

-- ─── LIVE TRACKING ──────────────────────────────────────────
-- Ensure rider GPS updates stream to subscribers in real time.
-- Without this, the live map only refreshes via the 5s client poll,
-- so rider markers lag behind the true position by many seconds.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'rider_locations') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE rider_locations;
    END IF;
  END IF;
END $$;

-- ─── DONE ────────────────────────────────────────────────────
-- These accelerate every dashboard query the app runs:
--   * Business: orders by merchant + status (Active/Pending/Delivered)
--   * Rider: available orders (status + no rider) / my deliveries
--   * Customer: order history
--   * Payments pipeline confirmation
--   * Merchant browsing by category
--   * Product menu listing
--   * Chat history
--   * Rider GPS tracking