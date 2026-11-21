-- Client deletion lifecycle extension.
-- Run after document_lifecycle.sql, client_portal.sql,
-- client_identity_profiles.sql, and delete_client_cascade.sql.
-- The backend worker owns Storage/Auth API calls; these functions own the
-- atomic database state transitions.

ALTER TABLE public.storage_cleanup_jobs
  ADD COLUMN IF NOT EXISTS portal_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.storage_cleanup_jobs
  DROP CONSTRAINT IF EXISTS storage_cleanup_jobs_status_check;

ALTER TABLE public.storage_cleanup_jobs
  ADD CONSTRAINT storage_cleanup_jobs_status_check CHECK (
    status IN (
      'pending', 'processing', 'retrying', 'auth_cleanup_pending',
      'failed', 'completed'
    )
  );

CREATE INDEX IF NOT EXISTS storage_cleanup_jobs_auth_due_idx
  ON public.storage_cleanup_jobs (next_attempt_at, created_at)
  WHERE status = 'auth_cleanup_pending';

CREATE TABLE IF NOT EXISTS public.client_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  cleanup_job_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  document_count integer NOT NULL DEFAULT 0,
  storage_object_count integer NOT NULL DEFAULT 0,
  portal_account_deleted boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS client_deletion_audit_owner_idx
  ON public.client_deletion_audit (owner_user_id, requested_at DESC);

ALTER TABLE public.client_deletion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_deletion_audit FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_deletion_audit TO service_role;

CREATE OR REPLACE FUNCTION public.request_client_deletion(
  p_user_id uuid,
  p_client_id uuid,
  p_storage_bucket text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_id uuid;
  portal_user uuid;
BEGIN
  SELECT COALESCE(access.user_id, profile.user_id)
  INTO portal_user
  FROM public.clients client
  LEFT JOIN public.client_portal_access access ON access.client_id = client.id
  LEFT JOIN public.client_user_profiles profile ON profile.client_id = client.id
  WHERE client.id = p_client_id AND client.user_id = p_user_id
  FOR UPDATE OF client;

  IF portal_user IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Client was not found or is already deleted.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.clients
  SET deletion_requested_at = COALESCE(deletion_requested_at, now())
  WHERE id = p_client_id AND user_id = p_user_id;

  SELECT id INTO job_id
  FROM public.storage_cleanup_jobs
  WHERE target_type = 'client'
    AND target_id = p_client_id
    AND user_id = p_user_id
    AND status <> 'completed'
  ORDER BY created_at DESC
  LIMIT 1;

  IF job_id IS NOT NULL THEN
    UPDATE public.storage_cleanup_jobs
    SET portal_user_id = COALESCE(portal_user_id, portal_user),
        storage_bucket = COALESCE(storage_bucket, p_storage_bucket)
    WHERE id = job_id;
    RETURN job_id;
  END IF;

  INSERT INTO public.storage_cleanup_jobs (
    target_type, target_id, client_id, user_id, portal_user_id,
    storage_bucket, next_attempt_at
  )
  VALUES (
    'client', p_client_id, p_client_id, p_user_id, portal_user,
    p_storage_bucket, now()
  )
  RETURNING id INTO job_id;

  INSERT INTO public.client_deletion_audit (client_id, owner_user_id, cleanup_job_id)
  VALUES (p_client_id, p_user_id, job_id);

  UPDATE public.client_portal_access
  SET active = false,
      access_status = 'revoked',
      invitation_pending = false,
      updated_at = now()
  WHERE client_id = p_client_id;

  RETURN job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_storage_cleanup_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job public.storage_cleanup_jobs%ROWTYPE;
  document_total integer := 0;
BEGIN
  SELECT * INTO job
  FROM public.storage_cleanup_jobs
  WHERE id = p_job_id AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;

  IF job.target_type = 'client' THEN
    SELECT count(*)::integer INTO document_total
    FROM public.documents_metadata
    WHERE client_id = job.client_id;

    -- All client-owned rows with a client FK are removed by the cascade
    -- policy. This delete is the transaction boundary for metadata cleanup.
    DELETE FROM public.clients
    WHERE id = job.client_id AND user_id = job.user_id;

    UPDATE public.storage_cleanup_jobs
    SET status = 'auth_cleanup_pending',
        next_attempt_at = now(),
        claimed_at = NULL,
        last_error = NULL
    WHERE id = p_job_id;

    UPDATE public.client_deletion_audit
    SET document_count = document_total
    WHERE cleanup_job_id = p_job_id;
  ELSE
    DELETE FROM public.documents_metadata
    WHERE id = job.target_id AND client_id = job.client_id;

    UPDATE public.storage_cleanup_jobs
    SET status = 'completed', completed_at = now(), claimed_at = NULL, last_error = NULL
    WHERE id = p_job_id;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_client_cleanup_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.storage_cleanup_jobs
  SET status = 'completed', completed_at = now(), claimed_at = NULL, last_error = NULL
  WHERE id = p_job_id AND target_type = 'client' AND status = 'auth_cleanup_pending';
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  UPDATE public.client_deletion_audit
  SET status = 'completed', completed_at = now(), portal_account_deleted = true
  WHERE cleanup_job_id = p_job_id;

  RETURN updated_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_client_auth_cleanup_job(
  p_job_id uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.storage_cleanup_jobs
  SET status = CASE WHEN attempt_count >= 10 THEN 'failed' ELSE 'auth_cleanup_pending' END,
      next_attempt_at = now() + make_interval(secs => LEAST(3600, 5 * (2 ^ LEAST(attempt_count, 9))::integer)),
      claimed_at = NULL,
      last_error = left(COALESCE(p_error, 'Portal account cleanup failed.'), 1000)
  WHERE id = p_job_id AND target_type = 'client'
    AND status IN ('processing', 'auth_cleanup_pending');
  RETURN FOUND;
END;
$$;

-- Extend the existing claim function to resume the final Auth phase after a
-- backend restart or a temporary Auth API failure.
CREATE OR REPLACE FUNCTION public.claim_storage_cleanup_job()
RETURNS SETOF public.storage_cleanup_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claimed_job public.storage_cleanup_jobs%ROWTYPE;
BEGIN
  DELETE FROM public.document_upload_reservations WHERE expires_at <= now();

  UPDATE public.storage_cleanup_jobs job
  SET status = 'processing', claimed_at = now(), attempt_count = attempt_count + 1
  WHERE job.id = (
    SELECT candidate.id
    FROM public.storage_cleanup_jobs candidate
    WHERE (
      (candidate.status IN ('pending', 'retrying', 'auth_cleanup_pending') AND candidate.next_attempt_at <= now())
      OR (candidate.status = 'processing' AND candidate.claimed_at < now() - interval '5 minutes')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.document_upload_reservations reservation
      WHERE reservation.expires_at > now()
        AND (reservation.client_id = candidate.client_id
          OR (candidate.target_type = 'document' AND reservation.document_id = candidate.target_id))
    )
    ORDER BY candidate.next_attempt_at, candidate.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING job.* INTO claimed_job;

  IF FOUND THEN RETURN NEXT claimed_job; END IF;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_client_cleanup_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_client_auth_cleanup_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_client_cleanup_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_client_auth_cleanup_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_storage_cleanup_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup_job() TO service_role;
