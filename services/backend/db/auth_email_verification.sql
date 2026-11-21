-- Email OTP verification for CA/staff account creation.
-- Run after schema.sql. The backend is the only role allowed to access this
-- table; plaintext OTP values are never stored.

CREATE TABLE IF NOT EXISTS public.auth_email_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_email_verification_user_idx
  ON public.auth_email_verification_challenges (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS auth_email_verification_one_active_idx
  ON public.auth_email_verification_challenges (user_id)
  WHERE consumed_at IS NULL;

ALTER TABLE public.auth_email_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_email_verification_challenges FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_email_verification_challenges TO service_role;
