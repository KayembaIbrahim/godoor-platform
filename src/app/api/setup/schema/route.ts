import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { isAdminCookieValid } from "@/lib/api-auth";

export async function POST() {
  if (!(await isAdminCookieValid())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const log: string[] = [];

  const execSQL = async (sql: string) => {
    try {
      const { error } = await sb.rpc("exec_sql", { query: sql });
      if (error) { log.push(`err: ${error.message?.substring(0, 80)}`); return false; }
      return true;
    } catch (e: any) { log.push(`exc: ${e.message?.substring(0, 80)}`); return false; }
  };

  // Create exec_sql function
  await execSQL(`CREATE OR REPLACE FUNCTION exec_sql(query text) RETURNS void AS $$ BEGIN EXECUTE query; END; $$ LANGUAGE plpgsql SECURITY DEFINER;`);

  // Riders table
  await execSQL(`CREATE TABLE IF NOT EXISTS riders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, email TEXT, vehicle_type TEXT DEFAULT 'motorbike', plate TEXT DEFAULT '', service_area TEXT DEFAULT 'Uganda', status TEXT DEFAULT 'online', verified BOOLEAN DEFAULT false, total_deliveries INTEGER DEFAULT 0, rating NUMERIC(2,1) DEFAULT 4.5, vehicle_photo_url TEXT, national_id_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`);
  await execSQL(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
  ALTER TABLE riders ENABLE ROW LEVEL SECURITY;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "Public read riders" ON riders FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "Service full riders" ON riders FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // Merchants columns
  for (const c of ["ALTER TABLE merchants ADD COLUMN IF NOT EXISTS shop_photo_url TEXT", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS trade_licence_url TEXT", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS national_id_url TEXT", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS logo_url TEXT", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS owner_id UUID", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS district TEXT DEFAULT ''", "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''"]) await execSQL(c);

  // Verification docs
  await execSQL(`CREATE TABLE IF NOT EXISTS verification_documents (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, document_type TEXT NOT NULL, file_url TEXT NOT NULL, file_name TEXT, status TEXT DEFAULT 'pending', admin_note TEXT, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());`);
  await execSQL(`ALTER TABLE verification_documents ENABLE ROW LEVEL SECURITY;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "vdocs_insert" ON verification_documents FOR INSERT WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "vdocs_all" ON verification_documents FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // Products
  await execSQL(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', price INTEGER NOT NULL DEFAULT 0, category TEXT DEFAULT 'Food', image_url TEXT DEFAULT '', images JSONB DEFAULT '[]', available BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, catalogue_id TEXT, created_at TIMESTAMPTZ DEFAULT now());`);
  await execSQL(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';`);
  await execSQL(`ALTER TABLE products ENABLE ROW LEVEL SECURITY;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "products_read" ON products FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "products_all" ON products FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // Catalogues
  await execSQL(`CREATE TABLE IF NOT EXISTS catalogues (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', cover_image_url TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());`);
  await execSQL(`ALTER TABLE catalogues ENABLE ROW LEVEL SECURITY;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "catalogues_read" ON catalogues FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "catalogues_all" ON catalogues FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // Followers
  await execSQL(`CREATE TABLE IF NOT EXISTS followers (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, customer_id TEXT NOT NULL, merchant_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(customer_id, merchant_id));`);
  await execSQL(`ALTER TABLE followers ENABLE ROW LEVEL SECURITY;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "followers_read" ON followers FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "followers_all" ON followers FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // Stories
  await execSQL(`CREATE TABLE IF NOT EXISTS stories (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, merchant_id TEXT NOT NULL, media_url TEXT NOT NULL, media_type TEXT DEFAULT 'image', caption TEXT DEFAULT '', expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT now());`);
  await execSQL(`ALTER TABLE stories ENABLE ROW LEVEL SECURITY;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "stories_read" ON stories FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await execSQL(`DO $$ BEGIN CREATE POLICY "stories_all" ON stories FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // Admin settings (admin portal password — service-role only)
  await execSQL(`CREATE TABLE IF NOT EXISTS admin_settings (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT now());`);
  await execSQL(`ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;`);

  // Storage policies
  for (const p of [
    `DO $$ BEGIN CREATE POLICY "sphotos_read" ON storage.objects FOR SELECT USING (bucket_id = 'store-photos'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "sphotos_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'store-photos'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "sphotos_update" ON storage.objects FOR UPDATE USING (bucket_id = 'store-photos'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "pimages_read" ON storage.objects FOR SELECT USING (bucket_id = 'product-images'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "pimages_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "stories_b_read" ON storage.objects FOR SELECT USING (bucket_id = 'stories'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "stories_b_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'stories'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "catimg_read" ON storage.objects FOR SELECT USING (bucket_id = 'catalogue-images'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "catimg_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'catalogue-images'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "verif_read" ON storage.objects FOR SELECT USING (bucket_id = 'verification'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "verif_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'verification'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "av_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    `DO $$ BEGIN CREATE POLICY "av_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  ]) await execSQL(p);

  // Verify
  const tables = ["merchants", "orders", "payments", "chat_messages", "rider_locations", "disputes", "riders", "verification_documents", "products", "catalogues", "followers", "stories", "admin_settings", "fee_config"];
  const existing: string[] = [];
  const missing: string[] = [];
  for (const t of tables) {
    try {
      const { error } = await sb.from(t).select("1").limit(0);
      if (error?.message?.includes("does not exist")) missing.push(t); else existing.push(t);
    } catch { missing.push(t); }
  }

  let hasLogo = false;
  try { await sb.from("merchants").select("logo_url").limit(1); hasLogo = true; } catch {}

  return NextResponse.json({ log: log.filter(l => l.startsWith("err")), existing, missing, hasLogo, allReady: missing.length === 0 && hasLogo });
}
