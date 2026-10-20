"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// DEBUG: Log environment variables
if (typeof window !== 'undefined') {
  console.log('DEBUG: Supabase environment check:', {
    url: SUPABASE_URL,
    key: SUPABASE_ANON_KEY ? '***' : 'NOT_SET',
    isSupabase: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && 
                        !SUPABASE_URL.includes("YOUR_PROJECT") && 
                        !SUPABASE_ANON_KEY.includes("YOUR_ANON"))
  });
}

// Fallback for Vercel deployment
if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR_PROJECT") || !SUPABASE_ANON_KEY) {
  console.warn('WARNING: Missing or invalid Supabase environment variables');
  // In Vercel environment, we might need to initialize with service role
  // but for client-side, we'll still create a client but it might not work
  // This ensures the app doesn't crash on initialization
}

/** True only when real Supabase credentials are configured */
export const IS_SUPABASE = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("YOUR_PROJECT") &&
    !SUPABASE_ANON_KEY.includes("YOUR_ANON"),
);

let _client: SupabaseClient | null = null;

/**
 * Get or create the Supabase browser client.
 * Returns null when credentials aren't configured (falls back to local store).
 */
export function getSupabase(): SupabaseClient | null {
  if (!IS_SUPABASE) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return _client;
}

/**
 * Server-side Supabase client (for API routes).
 * Uses the service role key for admin operations.
 */
export function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key || url.includes("YOUR_PROJECT")) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
