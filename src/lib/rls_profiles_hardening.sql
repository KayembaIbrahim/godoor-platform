-- rls_profiles_hardening.sql
-- Closes three tables that were left with Row Level Security DISABLED and no
-- policies at all, which made them fully readable by the PUBLIC anon key.
--
-- Verified live against production before this migration:
--   GET /rest/v1/profiles?select=id,email,phone,address,avatar_url
--     -> returned every user's email, phone, address and avatar
--   GET /rest/v1/payment_requests?select=*
--     -> returned Morse settlement rows (merchant + customer tags, amounts)
--   GET /rest/v1/rides?select=*
--     -> empty (orphan table, but still open)
--
-- Why these three were missed: the earlier `rls_hardening.sql` sweep listed
-- the tables it managed, and `profiles`, `payment_requests` and `rides` were
-- not among them — so a table that existed but was never named stayed open.
--
-- Strategy:
--   * `profiles` — a user may read and write ONLY their own row. Every other
--     access in the application is server-side service-role code (morse tag,
--     ledger, payouts, phone-change, transfers, withdrawals), and the service
--     role bypasses RLS, so those routes are unaffected.
--   * `payment_requests` — every access is server-side service-role code
--     (src/app/api/morse/request/route.ts). No client policy is needed; the
--     deny-all policy simply stops the anon key reading settlement rows.
--   * `rides` — an orphan table. Nothing in the application reads or writes it
--     (the live Boda flow uses `ride_requests`, which already had RLS). It is
--     locked rather than dropped: dropping a table from a production database
--     is not a change to make on a guess about its history.
--
-- Apply by sending the whole file as the `query` argument to exec_sql once.
-- (exec_sql is a SECURITY DEFINER void function run under the service role.)

-- ── profiles ────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gd_profiles_self_read ON public.profiles;
CREATE POLICY gd_profiles_self_read ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS gd_profiles_self_write ON public.profiles;
CREATE POLICY gd_profiles_self_write ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS gd_profiles_self_update ON public.profiles;
CREATE POLICY gd_profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── payment_requests (server-side only) ─────────────────────
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gd_payment_requests_admin_only ON public.payment_requests;
CREATE POLICY gd_payment_requests_admin_only ON public.payment_requests
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- ── rides (orphan, locked) ──────────────────────────────────
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gd_rides_admin_only ON public.rides;
CREATE POLICY gd_rides_admin_only ON public.rides
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
