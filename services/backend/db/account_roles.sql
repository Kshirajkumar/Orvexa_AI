-- Explicit Auth account categories.
-- Authorization uses app_metadata because it is server-controlled.
-- client_portal_access remains the source of truth for client-level access.

UPDATE auth.users AS account
SET raw_app_meta_data = COALESCE(account.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'client')
WHERE account.raw_app_meta_data ->> 'role' IS DISTINCT FROM 'client'
  AND (
    account.raw_app_meta_data ->> 'taxflow_client_portal' = 'true'
    OR EXISTS (
      SELECT 1
      FROM public.client_portal_access AS access
      WHERE access.user_id = account.id
        AND access.active = TRUE
    )
  );

UPDATE auth.users AS account
SET raw_app_meta_data = COALESCE(account.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'staff')
WHERE account.raw_app_meta_data ->> 'role' IS NULL;

NOTIFY pgrst, 'reload schema';
