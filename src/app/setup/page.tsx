"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Logo } from "@/components/Logo";
import { Database, CheckCircle2, Loader2, ExternalLink } from "lucide-react";

const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const SCHEMA_SQL = `-- GoDoor Database Schema
CREATE TABLE IF NOT EXISTS merchants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID, name TEXT NOT NULL, category TEXT NOT NULL, tagline TEXT DEFAULT '', area TEXT DEFAULT '', lat DOUBLE PRECISION DEFAULT 0, lng DOUBLE PRECISION DEFAULT 0, momo_number TEXT DEFAULT '', momo_name TEXT DEFAULT '', opens_at TEXT DEFAULT '08:00', closes_at TEXT DEFAULT '22:00', delivery_fee_ugx INTEGER DEFAULT 0, rating NUMERIC(2,1) DEFAULT 4.0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID, merchant_id UUID, rider_id UUID, customer_name TEXT DEFAULT '', customer_email TEXT DEFAULT '', merchant_name TEXT DEFAULT '', items TEXT DEFAULT '', total_ugx INTEGER NOT NULL, delivery_fee_ugx INTEGER DEFAULT 0, service_fee_ugx INTEGER DEFAULT 0, delivery_address TEXT DEFAULT '', customer_lat DOUBLE PRECISION DEFAULT 0, customer_lng DOUBLE PRECISION DEFAULT 0, status TEXT DEFAULT 'pending', payment_method TEXT DEFAULT 'momo', payment_confirmed BOOLEAN DEFAULT false, notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, merchant_id UUID, amount_ugx INTEGER NOT NULL, method TEXT DEFAULT 'momo', screenshot_url TEXT DEFAULT '', transaction_ref TEXT DEFAULT '', status TEXT DEFAULT 'pending', submitted_by TEXT DEFAULT '', confirmed_by TEXT DEFAULT '', note TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS chat_messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, sender_id TEXT DEFAULT '', sender_name TEXT NOT NULL, sender_role TEXT NOT NULL, text TEXT DEFAULT '', image_url TEXT DEFAULT '', read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS rider_locations (rider_id TEXT PRIMARY KEY, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, heading DOUBLE PRECISION DEFAULT 0, speed DOUBLE PRECISION DEFAULT 0, accuracy DOUBLE PRECISION DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS disputes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID, payment_id UUID, raised_by TEXT DEFAULT '', raised_by_name TEXT DEFAULT '', reason TEXT NOT NULL, status TEXT DEFAULT 'open', admin_note TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_chat_order ON chat_messages(order_id)`;
// Note: Already generated above as schema string. Placeholder object to avoid duplicate name.
const _SCHEMA = SCHEMA_SQL;

type Status = "idle" | "running" | "done" | "error";

export default function SetupPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState("");
  const [merchants, setMerchants] = useState(0);

  const checkDB = async () => {
    setStatus("running");
    setResult("Checking database connection...");
    try {
      const sb = createClient(URL_SB, ANON);
      const { error, count } = await sb.from("merchants").select("*", { count: "exact", head: true });
      if (!error) {
        setStatus("done");
        setMerchants(count || 0);
        setResult("Database is ready! Tables exist with " + (count || 0) + " merchants.");
      } else {
        setStatus("error");
        setResult("TABLES_NOT_CREATED");
      }
    } catch (e) {
      setStatus("error");
      setResult("Error: " + (e as Error).message);
    }
  };

  const openSQL = () => {
    const encoded = encodeURIComponent(SCHEMA_SQL);
    window.open("https://supabase.com/dashboard/project/llzqkduccdbbetevpoql/sql/new?" + encoded, "_blank");
  };

  return (
    <div className="hero-wash min-h-screen">
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="mb-8 flex justify-center"><Logo size="md" /></div>
        <h1 className="font-display text-2xl font-bold text-center">Database Setup</h1>
        <p className="mt-2 text-sm text-muted text-center">Connect GoDoor to your Supabase database.</p>

        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-3 mb-4">
            <Database className="h-5 w-5 text-go" />
            <h2 className="text-sm font-semibold">Step 1: Create Tables</h2>
          </div>
          <p className="text-xs text-muted mb-4">Open the Supabase SQL Editor and paste the schema, then click Run.</p>
          <a href="https://supabase.com/dashboard/project/llzqkduccdbbetevpoql/sql/new" target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl bg-go py-3 text-sm font-semibold text-white hover:bg-go-2">
            <ExternalLink className="h-4 w-4" /> Open Supabase SQL Editor
          </a>
          <p className="mt-2 text-[10px] text-dim text-center">
            Copy the schema from <a className="text-go underline" href="/schema-sql" target="_blank">/schema-sql</a> or your project files.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-3 mb-4">
            {status === "done" ? <CheckCircle2 className="h-5 w-5 text-success" /> : status === "running" ? <Loader2 className="h-5 w-5 text-go animate-spin" /> : <Database className="h-5 w-5 text-go" />}
            <h2 className="text-sm font-semibold">Step 2: Verify Connection</h2>
          </div>
          <button type="button" onClick={checkDB} disabled={status === "running"} className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface py-3 text-sm font-semibold text-fg hover:bg-elevated disabled:opacity-50">
            {status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {status === "running" ? "Checking..." : "Check Database Status"}
          </button>
          {result && result !== "TABLES_NOT_CREATED" && <div className="mt-3 rounded-xl bg-success/10 p-3 text-xs text-success">{result}</div>}
          {result === "TABLES_NOT_CREATED" && <div className="mt-3 rounded-xl bg-warning/10 p-3 text-xs text-warning">Tables not found yet. Open the SQL Editor above, paste the schema, click Run, then check again.</div>}
        </div>

        {status === "done" && <div className="mt-6 text-center"><a href="/" className="inline-flex items-center gap-2 rounded-2xl bg-go px-6 py-3 text-sm font-semibold text-white hover:bg-go-2">Go to GoDoor →</a></div>}

        <div className="mt-8 text-center text-xs text-dim">
          <p>GoDoor is fully functional with local data even without the database.</p>
          <p className="mt-1">Once tables are created, all data syncs to Supabase.</p>
        </div>
      </div>
    </div>
  );
}
