-- ─────────────────────────────────────────────────────────────────
-- Web Push subscriptions
--
-- One row per browser installation. `endpoint` is the browser-issued push
-- endpoint and is globally unique, so it doubles as the upsert key when the
-- same browser re-subscribes (which happens on every permission re-grant).
--
-- Security: like the money tables, this is service_role-only. The subscription
-- endpoint is a capability URL — anyone holding it can wake that browser, so
-- it must never be readable by anon or authenticated directly.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON public.push_subscriptions(user_id);

-- Service_role only.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
