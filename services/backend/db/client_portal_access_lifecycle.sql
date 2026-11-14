-- Client portal access lifecycle.
-- Run after client_portal.sql, client_portal_account_lifecycle.sql, and
-- client_identity_profiles.sql.
-- Pause preserves the enrolled client account. Revoke disables access and the
-- backend removes the verified client Auth user, which cascades client identity
-- profile rows. Existing documents and invite audit rows are preserved.

BEGIN;

ALTER TABLE public.client_portal_access
  ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.client_portal_access
  DROP CONSTRAINT IF EXISTS client_portal_access_status_check;

ALTER TABLE public.client_portal_access
  ADD CONSTRAINT client_portal_access_status_check
  CHECK (access_status IN ('active', 'paused', 'revoked'));

UPDATE public.client_portal_access
SET access_status = CASE
  WHEN active = TRUE THEN 'active'
  WHEN user_id IS NOT NULL THEN 'paused'
  ELSE 'revoked'
END
WHERE access_status IS NULL OR access_status = 'active';

CREATE INDEX IF NOT EXISTS client_portal_access_status_idx
  ON public.client_portal_access(client_id, access_status);

NOTIFY pgrst, 'reload schema';

COMMIT;
