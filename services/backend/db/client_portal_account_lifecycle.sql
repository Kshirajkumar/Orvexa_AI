-- Canonical client portal lifecycle.
-- Additive migration: preserves clients, documents, invite audit rows, and auth users.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_category TEXT NOT NULL DEFAULT 'ca_user';

UPDATE public.user_profiles
SET account_category = CASE
  WHEN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = user_profiles.id
      AND (u.raw_app_meta_data ->> 'role' = 'client'
        OR u.raw_app_meta_data ->> 'taxflow_client_portal' = 'true')
  ) THEN 'client_user'
  ELSE 'ca_user'
END;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_account_category_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_account_category_check
  CHECK (account_category IN ('ca_user', 'client_user'));

CREATE INDEX IF NOT EXISTS user_profiles_account_category_idx
  ON public.user_profiles(account_category);

-- At most one live invitation may exist for a client. Consumed/revoked rows remain
-- as an audit trail and cannot be reused.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_invites_one_live_per_client_idx
  ON public.client_portal_invites(client_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS client_portal_access_user_active_idx
  ON public.client_portal_access(user_id)
  WHERE user_id IS NOT NULL AND active = TRUE;

CREATE OR REPLACE FUNCTION public.sync_client_portal_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Portal identities are stored in client_user_profiles by the identity
  -- migration. Never create a duplicate user_profiles row here.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_portal_profile ON public.client_portal_access;
CREATE TRIGGER trg_sync_client_portal_profile
  AFTER INSERT OR UPDATE OF user_id, active ON public.client_portal_access
  FOR EACH ROW EXECUTE FUNCTION public.sync_client_portal_profile();

REVOKE ALL ON FUNCTION public.sync_client_portal_profile() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data ->> 'role', '') <> 'client'
     AND COALESCE(NEW.raw_app_meta_data ->> 'taxflow_client_portal', 'false') <> 'true' THEN
    INSERT INTO public.user_profiles (
      id, full_name, practice_type, membership_no, role, account_category
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'practice_type', 'Chartered Accountant (CA)'),
      NEW.raw_user_meta_data ->> 'membership_no',
      'Managing Partner',
      'ca_user'
    )
    ON CONFLICT (id) DO UPDATE SET
      account_category = 'ca_user',
      role = 'Managing Partner',
      updated_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
