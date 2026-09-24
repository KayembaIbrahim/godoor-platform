-- Add phone column to riders table
ALTER TABLE riders ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
-- Add phone to existing riders via UPDATE (no-op if column already exists)
UPDATE riders SET phone = '' WHERE phone IS NULL;
