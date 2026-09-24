-- GoDoor Database Schema for Supabase
-- Run this in the Supabase SQL Editor

-- Merchants table
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  tagline TEXT DEFAULT '',
  area TEXT DEFAULT '',
  lat DOUBLE PRECISION DEFAULT 0,
  lng DOUBLE PRECISION DEFAULT 0,
  momo_number TEXT DEFAULT '',
  momo_name TEXT DEFAULT '',
  opens_at TEXT DEFAULT '08:00',
  closes_at TEXT DEFAULT '22:00',
  delivery_fee_ugx INTEGER DEFAULT 0,
  rating NUMERIC(2,1) DEFAULT 4.0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant_id TEXT REFERENCES merchants(id),
  merchant_name TEXT NOT NULL,
  customer_name TEXT DEFAULT '',
  customer_email TEXT DEFAULT '',
  items TEXT NOT NULL,
  total_ugx INTEGER NOT NULL,
  delivery_fee_ugx INTEGER DEFAULT 0,
  delivery_address TEXT DEFAULT '',
  customer_lat DOUBLE PRECISION DEFAULT 0,
  customer_lng DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'payment_submitted', 'payment_confirmed',
    'preparing', 'rider_assigned', 'delivering', 'delivered',
    'cancelled', 'disputed'
  )),
  payment_method TEXT DEFAULT 'momo' CHECK (payment_method IN ('momo', 'airtel', 'cash')),
  rider_name TEXT,
  rider_phone TEXT,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  merchant_id TEXT REFERENCES merchants(id),
  amount_ugx INTEGER NOT NULL,
  method TEXT DEFAULT 'momo' CHECK (method IN ('momo', 'airtel', 'cash')),
  screenshot_url TEXT,
  transaction_ref TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'disputed', 'rejected')),
  submitted_by TEXT DEFAULT '',
  confirmed_by TEXT,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  sender TEXT NOT NULL CHECK (sender IN ('customer', 'merchant', 'admin')),
  sender_name TEXT NOT NULL,
  text TEXT DEFAULT '',
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  payment_id TEXT REFERENCES payments(id),
  raised_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  admin_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_chat_order ON chat_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

-- Enable Row Level Security (optional)
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- Public read policies (for demo — tighten for production)
CREATE POLICY "Public read merchants" ON merchants FOR SELECT USING (true);
CREATE POLICY "Public read orders" ON orders FOR SELECT USING (true);
CREATE POLICY "Public insert orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update orders" ON orders FOR UPDATE USING (true);
CREATE POLICY "Public read payments" ON payments FOR SELECT USING (true);
CREATE POLICY "Public insert payments" ON payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update payments" ON payments FOR UPDATE USING (true);
CREATE POLICY "Public read chat" ON chat_messages FOR SELECT USING (true);
CREATE POLICY "Public insert chat" ON chat_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read disputes" ON disputes FOR SELECT USING (true);
CREATE POLICY "Public insert disputes" ON disputes FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update disputes" ON disputes FOR UPDATE USING (true);
