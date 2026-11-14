-- Additive CA/client identity separation.
-- Run after schema.sql, account_roles.sql, and client_portal_account_lifecycle.sql.
-- This migration is intentionally non-destructive: user_profiles remains as a
-- compatibility table while application traffic moves to these source tables.

BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('taxflow.client_identity_profiles.v1', 0));

DO $$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('public.client_portal_access') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42P01',
      MESSAGE = 'Client identity migration prerequisites are missing',
      DETAIL = 'Run schema.sql and client_portal_account_lifecycle.sql before client_identity_profiles.sql.',
      HINT = 'No identity tables were changed because the migration stopped during its preflight check.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_taxflow_ca_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := 'TF-CA-' || upper(encode(gen_random_bytes(4), 'hex'));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.ca_user_profiles WHERE ca_code = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_taxflow_client_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := 'TF-CL-' || upper(encode(gen_random_bytes(4), 'hex'));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.client_user_profiles WHERE client_code = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE TABLE IF NOT EXISTS public.ca_user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ca_code TEXT NOT NULL UNIQUE DEFAULT public.generate_taxflow_ca_code(),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  practice_type TEXT NOT NULL DEFAULT 'Chartered Accountant (CA)',
  membership_no TEXT,
  role TEXT NOT NULL DEFAULT 'Managing Partner',
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ca_user_profiles_code_format CHECK (ca_code ~ '^TF-CA-[A-F0-9]{8}$')
);

CREATE TABLE IF NOT EXISTS public.client_user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  ca_user_id UUID NOT NULL REFERENCES public.ca_user_profiles(user_id) ON DELETE RESTRICT,
  ca_code TEXT NOT NULL REFERENCES public.ca_user_profiles(ca_code) ON UPDATE CASCADE,
  client_code TEXT NOT NULL UNIQUE DEFAULT public.generate_taxflow_client_code(),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_user_profiles_code_format CHECK (client_code ~ '^TF-CL-[A-F0-9]{8}$')
);

CREATE TABLE IF NOT EXISTS public.ca_client_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ca_user_id UUID NOT NULL REFERENCES public.ca_user_profiles(user_id) ON DELETE CASCADE,
  client_id UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  client_user_id UUID UNIQUE REFERENCES public.client_user_profiles(user_id) ON DELETE SET NULL,
  ca_code TEXT NOT NULL REFERENCES public.ca_user_profiles(ca_code) ON UPDATE CASCADE,
  client_code TEXT REFERENCES public.client_user_profiles(client_code) ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'revoked')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ca_client_relationship_verified_check CHECK (
    (status = 'verified' AND client_user_id IS NOT NULL AND client_code IS NOT NULL AND verified_at IS NOT NULL)
    OR status <> 'verified'
  )
);

CREATE INDEX IF NOT EXISTS ca_client_relationships_ca_idx
  ON public.ca_client_relationships(ca_user_id, status);
CREATE INDEX IF NOT EXISTS client_user_profiles_ca_idx
  ON public.client_user_profiles(ca_user_id, client_id);

CREATE OR REPLACE FUNCTION public.sync_ca_identity_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data ->> 'role', '') <> 'client'
     AND COALESCE(NEW.raw_app_meta_data ->> 'taxflow_client_portal', 'false') <> 'true' THEN
    INSERT INTO public.ca_user_profiles (
      user_id, full_name, email, practice_type, membership_no
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
      NEW.email,
      COALESCE(NEW.raw_user_meta_data ->> 'practice_type', 'Chartered Accountant (CA)'),
      NEW.raw_user_meta_data ->> 'membership_no'
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_ca_identity_profile() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created_identity_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_identity_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_ca_identity_profile();

-- Extend the existing portal-access trigger so a successful claim also creates
-- the client identity and verifies the CA/client relationship in one database
-- transaction. The legacy user_profiles row remains for compatibility only.
CREATE OR REPLACE FUNCTION public.sync_client_portal_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_ca public.ca_user_profiles%ROWTYPE;
  v_user auth.users%ROWTYPE;
  v_client_profile public.client_user_profiles%ROWTYPE;
BEGIN
  IF NEW.active = TRUE AND NEW.user_id IS NOT NULL THEN
    SELECT * INTO v_client
    FROM public.clients
    WHERE id = NEW.client_id;

    SELECT * INTO v_ca
    FROM public.ca_user_profiles
    WHERE user_id = v_client.user_id;

    SELECT * INTO v_user
    FROM auth.users
    WHERE id = NEW.user_id;

    IF v_client.id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        MESSAGE = 'Client portal access references a missing client',
        DETAIL = format('client_portal_access.client_id=%s', NEW.client_id);
    END IF;

    IF v_ca.user_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Client portal access cannot be verified because the owning CA profile is missing',
        DETAIL = format('client_id=%s, ca_user_id=%s', v_client.id, v_client.user_id),
        HINT = 'Create or repair the ca_user_profiles row before claiming the portal invitation.';
    END IF;

    IF v_user.id IS NULL OR COALESCE(v_user.email, '') = '' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Client portal access cannot be verified because the Auth account email is missing',
        DETAIL = format('client_user_id=%s', NEW.user_id);
    END IF;

    IF v_client.id IS NOT NULL AND v_ca.user_id IS NOT NULL AND v_user.id IS NOT NULL THEN
      INSERT INTO public.client_user_profiles (
        user_id, client_id, ca_user_id, ca_code, full_name, email, phone, onboarding_complete
      )
      VALUES (
        NEW.user_id,
        v_client.id,
        v_ca.user_id,
        v_ca.ca_code,
        COALESCE(v_user.raw_user_meta_data ->> 'full_name', v_client.name, ''),
        lower(btrim(COALESCE(v_user.email, v_client.email, NEW.invited_email))),
        v_client.phone,
        FALSE
      )
      ON CONFLICT (user_id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        ca_user_id = EXCLUDED.ca_user_id,
        ca_code = EXCLUDED.ca_code,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        updated_at = now()
      RETURNING * INTO v_client_profile;

      UPDATE public.ca_client_relationships
      SET client_user_id = v_client_profile.user_id,
          client_code = v_client_profile.client_code,
          status = 'verified',
          verified_at = COALESCE(verified_at, now()),
          updated_at = now()
      WHERE client_id = v_client.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_client_portal_profile() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.ca_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_client_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ca_client_relationships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ca_user_profiles_self ON public.ca_user_profiles;
CREATE POLICY ca_user_profiles_self ON public.ca_user_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS client_user_profiles_self ON public.client_user_profiles;
CREATE POLICY client_user_profiles_self ON public.client_user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS ca_client_relationships_self ON public.ca_client_relationships;
CREATE POLICY ca_client_relationships_self ON public.ca_client_relationships
  FOR SELECT TO authenticated
  USING (ca_user_id = auth.uid() OR client_user_id = auth.uid());

REVOKE ALL ON public.ca_user_profiles FROM anon;
REVOKE ALL ON public.client_user_profiles FROM anon;
REVOKE ALL ON public.ca_client_relationships FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.ca_user_profiles TO authenticated;
GRANT SELECT ON public.client_user_profiles, public.ca_client_relationships TO authenticated;
GRANT ALL ON public.ca_user_profiles, public.client_user_profiles, public.ca_client_relationships TO service_role;

-- Backfill CA source profiles from the existing category-controlled table.
INSERT INTO public.ca_user_profiles (user_id, full_name, email, practice_type, membership_no, role, onboarding_complete)
SELECT
  profile.id,
  profile.full_name,
  auth_user.email,
  profile.practice_type,
  profile.membership_no,
  profile.role,
  profile.onboarding_complete
FROM public.user_profiles AS profile
JOIN auth.users AS auth_user ON auth_user.id = profile.id
WHERE profile.account_category = 'ca_user'
ON CONFLICT (user_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  practice_type = EXCLUDED.practice_type,
  membership_no = EXCLUDED.membership_no,
  role = EXCLUDED.role,
  onboarding_complete = EXCLUDED.onboarding_complete,
  updated_at = now();

-- Create pending CA/client relationships for every owned client.
INSERT INTO public.ca_client_relationships (ca_user_id, client_id, ca_code, status)
SELECT client.user_id, client.id, ca.ca_code, 'pending'
FROM public.clients AS client
JOIN public.ca_user_profiles AS ca ON ca.user_id = client.user_id
ON CONFLICT (client_id) DO UPDATE SET
  ca_user_id = EXCLUDED.ca_user_id,
  ca_code = EXCLUDED.ca_code,
  updated_at = now();

-- Backfill already-claimed client portal accounts and mark their relationship verified.
INSERT INTO public.client_user_profiles (
  user_id, client_id, ca_user_id, ca_code, full_name, email, phone, onboarding_complete
)
SELECT
  access.user_id,
  client.id,
  client.user_id,
  ca.ca_code,
  COALESCE(profile.full_name, client.name),
  lower(btrim(COALESCE(auth_user.email, client.email))),
  client.phone,
  COALESCE(profile.onboarding_complete, FALSE)
FROM public.client_portal_access AS access
JOIN public.clients AS client ON client.id = access.client_id
JOIN public.ca_user_profiles AS ca ON ca.user_id = client.user_id
JOIN auth.users AS auth_user ON auth_user.id = access.user_id
LEFT JOIN public.user_profiles AS profile ON profile.id = access.user_id
WHERE access.active = TRUE
  AND access.user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET
  client_id = EXCLUDED.client_id,
  ca_user_id = EXCLUDED.ca_user_id,
  ca_code = EXCLUDED.ca_code,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  updated_at = now();

UPDATE public.ca_client_relationships AS relationship
SET
  client_user_id = client_profile.user_id,
  client_code = client_profile.client_code,
  status = 'verified',
  verified_at = COALESCE(relationship.verified_at, now()),
  updated_at = now()
FROM public.client_user_profiles AS client_profile
WHERE client_profile.client_id = relationship.client_id;

CREATE OR REPLACE FUNCTION public.ensure_ca_client_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ca public.ca_user_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_ca
  FROM public.ca_user_profiles
  WHERE user_id = NEW.user_id;

  IF v_ca.user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Client cannot be connected because the owning CA profile is missing',
      DETAIL = format('client_id=%s, ca_user_id=%s', NEW.id, NEW.user_id),
      HINT = 'Create the CA account profile before adding clients.';
  END IF;

  INSERT INTO public.ca_client_relationships (ca_user_id, client_id, ca_code, status)
  VALUES (v_ca.user_id, NEW.id, v_ca.ca_code, 'pending')
  ON CONFLICT (client_id) DO UPDATE SET
    ca_user_id = EXCLUDED.ca_user_id,
    ca_code = EXCLUDED.ca_code,
    updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_ca_client_relationship() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ensure_ca_client_relationship ON public.clients;
CREATE TRIGGER trg_ensure_ca_client_relationship
  AFTER INSERT OR UPDATE OF user_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ca_client_relationship();

NOTIFY pgrst, 'reload schema';

COMMIT;
