import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient<any, any, any>;

/**
 * Idempotent Phase 2 clinic schema provisioning. Every helper swallows errors
 * so an unmigrated database degrades gracefully instead of 500ing.
 */

export const CLINIC_QUEUE_STATUSES = ["waiting", "in_consultation", "done", "no_show"];

/** Orders columns needed by the clinic flow + the extended status CHECK. */
export async function ensureClinicOrderSchema(sb: Sb): Promise<void> {
  try {
    await sb.rpc("exec_sql", {
      query: `
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS medicine_subtotal_ugx INTEGER DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS medicine_paid BOOLEAN DEFAULT false;
        ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
        ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
          'pending', 'payment_submitted', 'payment_confirmed',
          'preparing', 'ready', 'rider_assigned', 'rider_picking_up',
          'picked_up', 'delivering', 'delivered', 'cancelled', 'disputed',
          'medicines_ready'
        ));
      `,
    });
  } catch {}
}

/** The clinic_queue table + indexes + RLS + realtime publication. */
export async function ensureClinicQueue(sb: Sb): Promise<void> {
  try {
    await sb.rpc("exec_sql", {
      query: `
        CREATE TABLE IF NOT EXISTS clinic_queue (
          order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
          merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
          queue_number INTEGER NOT NULL,
          status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_consultation', 'done', 'no_show')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_clinic_queue_merchant ON clinic_queue(merchant_id, created_at);
        ALTER TABLE clinic_queue ENABLE ROW LEVEL SECURITY;
        DO $$ BEGIN
          CREATE POLICY "Public read clinic queue" ON clinic_queue FOR SELECT USING (true);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE POLICY "Clinic manage queue" ON clinic_queue FOR ALL USING (
            EXISTS (SELECT 1 FROM merchants WHERE id = merchant_id AND owner_id = auth.uid())
          );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `,
    });
  } catch {}
  try {
    await sb.rpc("exec_sql", { query: `ALTER PUBLICATION supabase_realtime ADD TABLE clinic_queue;` });
  } catch {}
}

/** Self-heal a write path before it touches clinic data. */
export async function ensureClinicSchema(sb: Sb): Promise<void> {
  await ensureClinicOrderSchema(sb);
  await ensureClinicQueue(sb);
}