-- Portal identities are not staff accounts and must not require a staff profile.
-- Run after schema.sql and before enabling portal enrollment in production.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, practice_type, membership_no, role, account_category)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    COALESCE(NEW.raw_user_meta_data ->> 'practice_type', 'Chartered Accountant (CA)'),
    NEW.raw_user_meta_data ->> 'membership_no',
    CASE WHEN COALESCE(NEW.raw_app_meta_data ->> 'role', '') = 'client'
      OR COALESCE(NEW.raw_app_meta_data ->> 'taxflow_client_portal', 'false') = 'true'
      THEN 'Client User' ELSE 'Managing Partner' END,
    CASE WHEN COALESCE(NEW.raw_app_meta_data ->> 'role', '') = 'client'
      OR COALESCE(NEW.raw_app_meta_data ->> 'taxflow_client_portal', 'false') = 'true'
      THEN 'client_user' ELSE 'ca_user' END
  )
  ON CONFLICT (id) DO UPDATE SET
    account_category = EXCLUDED.account_category,
    role = EXCLUDED.role,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
