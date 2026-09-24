-- Live location sharing for "traveling to your door" businesses
-- (makeup, salons, mobile services). The store's map pin stays static at the
-- registered `lat`/`lng`; the owner opts IN per-business with
-- `merchants.live_location_enabled`, and only then does the app stream their
-- GPS into `provider_locations` so customers can watch them arrive.
DO $do$
BEGIN
  ALTER TABLE merchants ADD COLUMN IF NOT EXISTS live_location_enabled BOOLEAN NOT NULL DEFAULT false;

  CREATE TABLE IF NOT EXISTS provider_locations (
    provider_id UUID PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    lng DOUBLE PRECISION NOT NULL DEFAULT 0,
    heading DOUBLE PRECISION DEFAULT 0,
    speed DOUBLE PRECISION DEFAULT 0,
    accuracy DOUBLE PRECISION DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE provider_locations ENABLE ROW LEVEL SECURITY;

  EXECUTE $p$ DROP POLICY IF EXISTS "gd_provider_locations_select" ON provider_locations $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "gd_provider_locations_insert" ON provider_locations $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "gd_provider_locations_update" ON provider_locations $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "gd_provider_locations_delete" ON provider_locations $p$;

  -- Signed-in users may read provider positions (needed for tracking);
  -- only the owning merchant may insert/update/delete their own row.
  EXECUTE $p$ CREATE POLICY "gd_provider_locations_select" ON provider_locations FOR SELECT USING (auth.uid() IS NOT NULL) $p$;
  EXECUTE $p$ CREATE POLICY "gd_provider_locations_insert" ON provider_locations FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM merchants m WHERE m.id = provider_locations.provider_id AND m.owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_provider_locations_update" ON provider_locations FOR UPDATE USING (EXISTS (SELECT 1 FROM merchants m WHERE m.id = provider_locations.provider_id AND m.owner_id::text = auth.uid()::text)) $p$;
  EXECUTE $p$ CREATE POLICY "gd_provider_locations_delete" ON provider_locations FOR DELETE USING (EXISTS (SELECT 1 FROM merchants m WHERE m.id = provider_locations.provider_id AND m.owner_id::text = auth.uid()::text)) $p$;

  RAISE NOTICE 'live sharing schema applied';
END $do$;