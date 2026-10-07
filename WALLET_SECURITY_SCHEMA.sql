-- ─────────────────────────────────────────────────────────────────────────────
-- GoDoor · Wallet security (PIN + biometric)
--
-- Adds the table that backs src/lib/wallet-security.ts.
--
-- NOTHING here touches money movement. It stores proof-of-knowledge for the
-- customer: a PBKDF2 hash of their wallet PIN, and a WebAuthn credential for
-- fingerprint / face unlock. Spending still goes through escrow; this only
-- gates who may authorise it.
--
-- Apply:  node scripts/apply-sql.mjs WALLET_SECURITY_SCHEMA.sql
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.wallet_security (
  user_id            uuid primary key references auth.users(id) on delete cascade,

  -- PBKDF2-SHA256, 210k iterations. The plaintext PIN is never stored, never
  -- logged, and never leaves the server.
  pin_hash           text,
  pin_salt           text,
  pin_set_at         timestamptz,

  -- Progressive lockout, driven by src/lib/wallet-security.ts lockFor().
  failed_attempts    integer not null default 0,
  locked_until       timestamptz,

  -- WebAuthn platform authenticator (fingerprint / face). public_key holds a
  -- JWK converted from the browser's COSE key at enrolment, because WebCrypto
  -- cannot verify against COSE.
  bio_credential_id  text,
  bio_public_key     jsonb,
  bio_sign_count     bigint not null default 0,

  -- Single-use challenge, so a captured assertion cannot be replayed.
  bio_challenge      text,
  bio_challenge_exp  timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.wallet_security is
  'Per-customer wallet authorisation: PBKDF2 PIN hash + WebAuthn credential. Grants are signed server-side, never stored here.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- The server uses the service role and bypasses RLS. Client access is denied
-- outright: a browser that can read this table could read the PIN hash.

alter table public.wallet_security enable row level security;

-- No policies on purpose. RLS with zero policies denies every non-service-role
-- read and write, which is exactly what this table wants. Granting a
-- self-select policy would expose the PIN hash to the account holder's own
-- browser console, which defeats the point of hashing it.

revoke all on public.wallet_security from anon, authenticated;

-- ── Grants ───────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
-- Intentionally no table grant: access is via the service role only.