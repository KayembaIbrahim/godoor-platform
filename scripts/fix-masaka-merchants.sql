-- Move businesses whose TEXT says Masaka but whose coordinates say Kampala.
-- Strain and buds ( Masaka) was created with the hard-coded 0.3533,32.5822
-- placeholder, which the 25 km catalogue radius filtered as a Kampala shop.
-- Masaka centre: -0.3356, 31.7341 (uganda-places gazetteer).
UPDATE public.merchants
SET lat = -0.3356, lng = 31.7341, district = 'Masaka',
    updated_at = NOW()
WHERE id = '4fe6d2f5-6668-450a-a0f1-51cb6a26fcb9';
