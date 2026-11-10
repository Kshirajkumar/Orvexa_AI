-- Durable client/document deletion, upload reservations, and immutable file versions.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

ALTER TABLE public.documents_metadata
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  storage_bucket text NOT NULL,
  storage_object_path text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_kb numeric(10, 2),
  file_sha256 text,
  mime_type text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number),
  UNIQUE (storage_bucket, storage_object_path)
);

INSERT INTO public.document_versions (
  document_id, version_number, storage_bucket, storage_object_path,
  file_name, file_type, file_size_kb, file_sha256, mime_type, created_at
)
SELECT
  id, 1, storage_bucket, storage_object_path,
  file_name, file_type, file_size_kb, file_sha256, mime_type, created_at
FROM public.documents_metadata
WHERE storage_bucket IS NOT NULL
  AND storage_object_path IS NOT NULL
ON CONFLICT (document_id, version_number) DO NOTHING;

CREATE INDEX IF NOT EXISTS document_versions_document_idx
  ON public.document_versions (document_id, version_number DESC);

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_versions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_versions TO service_role;

CREATE TABLE IF NOT EXISTS public.document_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  document_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (id, owner_user_id, client_id, document_id)
);

CREATE INDEX IF NOT EXISTS document_upload_reservations_client_expiry_idx
  ON public.document_upload_reservations (client_id, expires_at);
CREATE INDEX IF NOT EXISTS document_upload_reservations_document_expiry_idx
  ON public.document_upload_reservations (document_id, expires_at);

ALTER TABLE public.document_upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_upload_reservations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_upload_reservations TO service_role;

CREATE TABLE IF NOT EXISTS public.storage_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('client', 'document')),
  target_id uuid NOT NULL,
  client_id uuid NOT NULL,
  user_id uuid NOT NULL,
  storage_bucket text NOT NULL,
  object_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retrying', 'failed', 'completed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (target_type, target_id)
);

CREATE INDEX IF NOT EXISTS storage_cleanup_jobs_due_idx
  ON public.storage_cleanup_jobs (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retrying', 'processing');
CREATE INDEX IF NOT EXISTS storage_cleanup_jobs_user_idx
  ON public.storage_cleanup_jobs (user_id, created_at DESC);

ALTER TABLE public.storage_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_cleanup_jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.storage_cleanup_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.begin_document_upload(
  p_user_id uuid,
  p_client_id uuid,
  p_document_id uuid,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reservation_id uuid;
  document_client_id uuid;
  document_deletion_requested_at timestamptz;
BEGIN
  PERFORM 1
  FROM public.clients
  WHERE id = p_client_id
    AND user_id = p_user_id
    AND deletion_requested_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client is not available for uploads.' USING ERRCODE = 'P0002';
  END IF;

  SELECT client_id, deletion_requested_at
  INTO document_client_id, document_deletion_requested_at
  FROM public.documents_metadata
  WHERE id = p_document_id
  FOR UPDATE;
  IF FOUND AND (
    document_client_id <> p_client_id OR document_deletion_requested_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Document is not available for uploads.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.document_upload_reservations (
    owner_user_id, client_id, document_id, created_by, expires_at
  )
  VALUES (p_user_id, p_client_id, p_document_id, p_created_by, now() + interval '30 minutes')
  RETURNING id INTO reservation_id;

  RETURN reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_document_metadata_if_client_active(
  p_user_id uuid,
  p_reservation_id uuid,
  p_document jsonb
)
RETURNS public.documents_metadata
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_row public.documents_metadata%ROWTYPE;
  saved_document public.documents_metadata%ROWTYPE;
BEGIN
  document_row := jsonb_populate_record(NULL::public.documents_metadata, p_document);
  document_row.updated_at := COALESCE(document_row.updated_at, now());

  PERFORM 1
  FROM public.clients c
  JOIN public.document_upload_reservations r
    ON r.client_id = c.id
   AND r.document_id = document_row.id
   AND r.owner_user_id = p_user_id
   AND r.id = p_reservation_id
  WHERE c.id = document_row.client_id
    AND c.user_id = p_user_id
    AND c.deletion_requested_at IS NULL
    AND r.expires_at > now()
  FOR UPDATE OF c, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload reservation or active client was not found.' USING ERRCODE = 'P0002';
  END IF;

  IF document_row.storage_bucket IS NOT NULL AND (
    document_row.storage_object_path NOT LIKE p_user_id::text || '/' || document_row.client_id::text || '/%'
    OR position('/' || document_row.id::text || '_' IN document_row.storage_object_path) = 0
  ) THEN
    RAISE EXCEPTION 'Document object path is outside the expected client namespace.';
  END IF;

  INSERT INTO public.documents_metadata
  SELECT (document_row).*
  RETURNING * INTO saved_document;

  IF saved_document.storage_bucket IS NOT NULL AND saved_document.storage_object_path IS NOT NULL THEN
    INSERT INTO public.document_versions (
      document_id, version_number, storage_bucket, storage_object_path,
      file_name, file_type, file_size_kb, file_sha256, mime_type, created_by, created_at
    )
    VALUES (
      saved_document.id, 1, saved_document.storage_bucket, saved_document.storage_object_path,
      saved_document.file_name, saved_document.file_type, saved_document.file_size_kb,
      saved_document.file_sha256, saved_document.mime_type,
      (SELECT r.created_by FROM public.document_upload_reservations r WHERE r.id = p_reservation_id),
      saved_document.created_at
    );
  END IF;

  DELETE FROM public.document_upload_reservations WHERE id = p_reservation_id;
  RETURN saved_document;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_document_version(
  p_user_id uuid,
  p_reservation_id uuid,
  p_document_id uuid,
  p_storage_bucket text,
  p_storage_object_path text,
  p_file_name text,
  p_file_type text,
  p_file_size_kb numeric,
  p_file_sha256 text,
  p_mime_type text
)
RETURNS public.document_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_row public.documents_metadata%ROWTYPE;
  version_row public.document_versions%ROWTYPE;
  next_version integer;
BEGIN
  SELECT d.*
  INTO document_row
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  JOIN public.document_upload_reservations r
    ON r.client_id = c.id
   AND r.document_id = d.id
   AND r.owner_user_id = p_user_id
   AND r.id = p_reservation_id
  WHERE d.id = p_document_id
    AND c.user_id = p_user_id
    AND c.deletion_requested_at IS NULL
    AND d.deletion_requested_at IS NULL
    AND r.expires_at > now()
  FOR UPDATE OF d, c, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload reservation or active document was not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_storage_bucket <> document_row.storage_bucket
    AND document_row.storage_bucket IS NOT NULL THEN
    RAISE EXCEPTION 'Document versions must remain in the configured private bucket.';
  END IF;
  IF p_storage_object_path NOT LIKE
    p_user_id::text || '/' || document_row.client_id::text || '/documents/'
      || p_document_id::text || '/%' THEN
    RAISE EXCEPTION 'Document version path is outside the document storage namespace.';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM public.document_versions
  WHERE document_id = p_document_id;

  INSERT INTO public.document_versions (
    document_id, version_number, storage_bucket, storage_object_path,
    file_name, file_type, file_size_kb, file_sha256, mime_type, created_by
  )
  SELECT
    p_document_id, next_version, p_storage_bucket, p_storage_object_path,
    p_file_name, p_file_type, p_file_size_kb, p_file_sha256, p_mime_type, r.created_by
  FROM public.document_upload_reservations r
  WHERE r.id = p_reservation_id
  RETURNING * INTO version_row;

  UPDATE public.documents_metadata
  SET storage_bucket = p_storage_bucket,
      storage_object_path = p_storage_object_path,
      file_name = p_file_name,
      file_type = p_file_type,
      file_size_kb = p_file_size_kb,
      file_sha256 = p_file_sha256,
      mime_type = p_mime_type,
      updated_at = now()
  WHERE id = p_document_id;

  DELETE FROM public.document_upload_reservations WHERE id = p_reservation_id;
  RETURN version_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_document_upload(p_user_id uuid, p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.document_upload_reservations
  WHERE id = p_reservation_id AND owner_user_id = p_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

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
BEGIN
  UPDATE public.clients
  SET deletion_requested_at = COALESCE(deletion_requested_at, now())
  WHERE id = p_client_id
    AND user_id = p_user_id
    AND deletion_requested_at IS NULL;

  IF NOT FOUND THEN
    SELECT id INTO job_id
    FROM public.storage_cleanup_jobs
    WHERE target_type = 'client'
      AND target_id = p_client_id
      AND user_id = p_user_id
      AND status <> 'completed';
    IF job_id IS NULL THEN
      RAISE EXCEPTION 'Client was not found or is already deleted.' USING ERRCODE = 'P0002';
    END IF;
    RETURN job_id;
  END IF;

  INSERT INTO public.storage_cleanup_jobs (
    target_type, target_id, client_id, user_id, storage_bucket, next_attempt_at
  )
  VALUES (
    'client', p_client_id, p_client_id, p_user_id, p_storage_bucket,
    COALESCE((
      SELECT MAX(expires_at)
      FROM public.document_upload_reservations
      WHERE client_id = p_client_id
        AND expires_at > now()
    ), now())
  )
  RETURNING id INTO job_id;
  RETURN job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_document_deletion(
  p_user_id uuid,
  p_document_id uuid,
  p_storage_bucket text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  owning_client_id uuid;
  job_id uuid;
  object_paths text[];
BEGIN
  UPDATE public.documents_metadata d
  SET deletion_requested_at = COALESCE(d.deletion_requested_at, now())
  FROM public.clients c
  WHERE d.id = p_document_id
    AND d.client_id = c.id
    AND c.user_id = p_user_id
    AND c.deletion_requested_at IS NULL
    AND d.deletion_requested_at IS NULL
    AND d.source <> 'Telegram'
  RETURNING d.client_id INTO owning_client_id;

  IF NOT FOUND THEN
    SELECT id INTO job_id
    FROM public.storage_cleanup_jobs
    WHERE target_type = 'document'
      AND target_id = p_document_id
      AND user_id = p_user_id
      AND status <> 'completed';
    IF job_id IS NULL THEN
      RAISE EXCEPTION 'Document was not found or is already deleted.' USING ERRCODE = 'P0002';
    END IF;
    RETURN job_id;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT object_path), ARRAY[]::text[])
  INTO object_paths
  FROM (
    SELECT storage_object_path AS object_path
    FROM public.documents_metadata
    WHERE id = p_document_id
      AND storage_bucket = p_storage_bucket
      AND storage_object_path IS NOT NULL
    UNION ALL
    SELECT storage_object_path
    FROM public.document_versions
    WHERE document_id = p_document_id
      AND storage_bucket = p_storage_bucket
  ) paths;

  INSERT INTO public.storage_cleanup_jobs (
    target_type, target_id, client_id, user_id, storage_bucket, object_paths,
    next_attempt_at
  )
  VALUES (
    'document', p_document_id, owning_client_id, p_user_id, p_storage_bucket,
    object_paths,
    COALESCE((
      SELECT MAX(expires_at)
      FROM public.document_upload_reservations
      WHERE document_id = p_document_id
        AND expires_at > now()
    ), now())
  )
  RETURNING id INTO job_id;
  RETURN job_id;
END;
$$;

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

  UPDATE public.storage_cleanup_jobs j
  SET status = 'processing',
      claimed_at = now(),
      attempt_count = attempt_count + 1
  WHERE j.id = (
    SELECT candidate.id
    FROM public.storage_cleanup_jobs candidate
    WHERE (
        (candidate.status IN ('pending', 'retrying') AND candidate.next_attempt_at <= now())
        OR (candidate.status = 'processing' AND candidate.claimed_at < now() - interval '5 minutes')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.document_upload_reservations r
        WHERE r.expires_at > now()
          AND (
            r.client_id = candidate.client_id
            OR (candidate.target_type = 'document' AND r.document_id = candidate.target_id)
          )
      )
    ORDER BY candidate.next_attempt_at, candidate.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.* INTO claimed_job;

  IF FOUND THEN RETURN NEXT claimed_job; END IF;
  RETURN;
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
BEGIN
  SELECT * INTO job
  FROM public.storage_cleanup_jobs
  WHERE id = p_job_id AND status = 'processing'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF job.target_type = 'client' THEN
    DELETE FROM public.clients WHERE id = job.client_id AND user_id = job.user_id;
  ELSE
    DELETE FROM public.documents_metadata
    WHERE id = job.target_id AND client_id = job.client_id;
  END IF;

  UPDATE public.storage_cleanup_jobs
  SET status = 'completed', completed_at = now(), claimed_at = NULL, last_error = NULL
  WHERE id = p_job_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_storage_cleanup_job(p_job_id uuid, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_status text;
BEGIN
  UPDATE public.storage_cleanup_jobs
  SET status = CASE WHEN attempt_count >= 10 THEN 'failed' ELSE 'retrying' END,
      next_attempt_at = now() + make_interval(secs => LEAST(3600, 5 * (2 ^ LEAST(attempt_count, 9))::integer)),
      claimed_at = NULL,
      last_error = left(COALESCE(p_error, 'Storage cleanup failed.'), 1000)
  WHERE id = p_job_id AND status = 'processing'
  RETURNING status INTO new_status;
  RETURN new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_storage_cleanup_job(p_job_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.storage_cleanup_jobs
  SET status = 'pending', attempt_count = 0, next_attempt_at = now(),
      claimed_at = NULL, last_error = NULL, completed_at = NULL
  WHERE id = p_job_id AND user_id = p_user_id AND status = 'failed';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_document_upload(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_document_metadata_if_client_active(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_document_version(uuid, uuid, uuid, text, text, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_document_upload(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_client_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_document_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_storage_cleanup_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_storage_cleanup_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_storage_cleanup_job(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_storage_cleanup_job(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_document_upload(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_document_metadata_if_client_active(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_document_version(uuid, uuid, uuid, text, text, text, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_document_upload(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_client_deletion(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_document_deletion(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_storage_cleanup_job(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_storage_cleanup_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_storage_cleanup_job(uuid, uuid) TO service_role;
