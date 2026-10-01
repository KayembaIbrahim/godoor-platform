-- ─────────────────────────────────────────────────────────────────
-- Realtime publication membership, readable
--
-- The app's exec_sql helper runs DDL but does not return SELECT result
-- sets, so querying pg_publication_tables through it always looked empty
-- even though every table was already a member. This function returns the
-- membership as rows so the diagnostic can actually see it.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.realtime_publication_tables()
RETURNS TABLE(tablename text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.relname::text
  FROM pg_publication p
  JOIN pg_publication_rel pr ON pr.prpubid = p.oid
  JOIN pg_class c ON c.oid = pr.prrelid
  WHERE p.pubname = 'supabase_realtime'
  ORDER BY c.relname
$$;

REVOKE ALL ON FUNCTION public.realtime_publication_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.realtime_publication_tables() TO service_role;
