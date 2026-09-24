import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient<any, any, any>;

/**
 * Idempotent Store Riders (business-owned courier fleets) schema provisioning.
 * Swallows errors so an unmigrated database degrades gracefully.
 */
export async function ensureMerchantRiders(sb: Sb): Promise<void> {
  try {
    await sb.rpc("exec_sql", {
      query: `
        CREATE TABLE IF NOT EXISTS merchant_riders (
          merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
          rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'declined', 'removed')),
          rate_ugx INTEGER NOT NULL DEFAULT 0,
          accepted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (merchant_id, rider_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_riders_one_active ON merchant_riders (rider_id) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_merchant_riders_merchant ON merchant_riders (merchant_id, status);
        ALTER TABLE merchant_riders ENABLE ROW LEVEL SECURITY;
        DO $$ BEGIN
          CREATE POLICY "Merchant own riders" ON merchant_riders FOR ALL USING (
            EXISTS (SELECT 1 FROM merchants WHERE id = merchant_id AND owner_id = auth.uid())
          );
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE POLICY "Rider read own memberships" ON merchant_riders FOR SELECT USING (rider_id = auth.uid());
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE POLICY "Rider accept own invite" ON merchant_riders FOR UPDATE USING (rider_id = auth.uid());
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `,
    });
  } catch {}
  try {
    await sb.rpc("exec_sql", { query: `ALTER PUBLICATION supabase_realtime ADD TABLE merchant_riders;` });
  } catch {}
}