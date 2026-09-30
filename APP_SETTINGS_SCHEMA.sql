-- ─────────────────────────────────────────────────────────────────
-- App settings: small admin-editable key/value store
--
-- Used for values the landing page or app shell reads but that should be
-- changeable without a deploy - currently the published APK release.
--
-- Service-role only: the values are read by public pages, so they must never
-- be writable through the client.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
