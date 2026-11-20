-- Immutable AI/review extraction history and file activity ledger.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.documents_metadata
  ADD COLUMN IF NOT EXISTS extraction_status text,
  ADD COLUMN IF NOT EXISTS current_extraction_version integer,
  ADD COLUMN IF NOT EXISTS approved_extraction_version integer,
  ADD COLUMN IF NOT EXISTS extraction_schema_version text;

CREATE TABLE IF NOT EXISTS public.extraction_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  version_kind text NOT NULL CHECK (version_kind IN ('ai', 'ai_rerun', 'edit', 'restore')),
  data jsonb NOT NULL,
  provider_score numeric(5,4),
  computed_score numeric(5,4),
  review_score numeric(5,4),
  schema_version text NOT NULL,
  changed_field_count integer NOT NULL DEFAULT 0 CHECK (changed_field_count >= 0),
  changed_field_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  base_version integer,
  content_sha256 text NOT NULL,
  previous_sha256 text,
  extraction_run_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number),
  UNIQUE (document_id, content_sha256)
);

CREATE INDEX IF NOT EXISTS extraction_versions_document_idx
  ON public.extraction_versions (document_id, version_number DESC);

CREATE TABLE IF NOT EXISTS public.extraction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  version_number integer,
  event text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'ca', 'client')),
  actor_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_file_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  operation text NOT NULL,
  file_name text,
  file_size_before_kb numeric(12,2),
  file_size_after_kb numeric(12,2),
  file_sha256 text,
  storage_bucket text,
  storage_object_path text,
  version_number integer,
  changed_field_count integer NOT NULL DEFAULT 0,
  changed_field_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_file_activity_document_idx
  ON public.document_file_activity (document_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_document_file_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.document_file_activity (
    document_id, client_id, operation, file_name, file_size_before_kb,
    file_sha256, storage_bucket, storage_object_path, status, note
  ) VALUES (
    OLD.id, OLD.client_id, 'deleted', OLD.file_name, OLD.file_size_kb,
    OLD.file_sha256, OLD.storage_bucket, OLD.storage_object_path,
    'completed', 'Document metadata deleted after the storage cleanup workflow completed.'
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_file_delete_activity ON public.documents_metadata;
CREATE TRIGGER trg_document_file_delete_activity
  BEFORE DELETE ON public.documents_metadata
  FOR EACH ROW EXECUTE FUNCTION public.record_document_file_delete();

ALTER TABLE public.extraction_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_file_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extraction_versions, public.extraction_events, public.document_file_activity FROM anon, authenticated;
GRANT SELECT ON public.extraction_versions, public.extraction_events, public.document_file_activity TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.extraction_versions, public.extraction_events, public.document_file_activity TO service_role;

CREATE OR REPLACE FUNCTION public.save_extraction_version(
  p_user_id uuid,
  p_document_id uuid,
  p_version_kind text,
  p_data jsonb,
  p_provider_score numeric,
  p_computed_score numeric,
  p_schema_version text,
  p_base_version integer DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_changed_field_paths jsonb DEFAULT '[]'::jsonb
)
RETURNS public.extraction_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_row public.documents_metadata%ROWTYPE;
  version_row public.extraction_versions%ROWTYPE;
  next_version integer;
  previous_hash text;
  changed_count integer;
BEGIN
  SELECT d.* INTO document_row
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  WHERE d.id = p_document_id AND c.user_id = p_user_id
    AND d.deletion_requested_at IS NULL
  FOR UPDATE OF d, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document was not found in your workspace.' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
  FROM public.extraction_versions WHERE document_id = p_document_id;
  IF p_base_version IS NOT NULL AND p_base_version <> next_version - 1 THEN
    RAISE EXCEPTION 'A newer extraction version already exists.' USING ERRCODE = '40001';
  END IF;
  SELECT content_sha256 INTO previous_hash FROM public.extraction_versions
  WHERE document_id = p_document_id ORDER BY version_number DESC LIMIT 1;
  changed_count := jsonb_array_length(COALESCE(p_changed_field_paths, '[]'::jsonb));

  INSERT INTO public.extraction_versions (
    document_id, client_id, version_number, version_kind, data,
    provider_score, computed_score, schema_version, changed_field_count,
    changed_field_paths, note, base_version, content_sha256, previous_sha256, created_by
  ) VALUES (
    p_document_id, document_row.client_id, next_version, p_version_kind, p_data,
    p_provider_score, p_computed_score, p_schema_version, changed_count,
    COALESCE(p_changed_field_paths, '[]'::jsonb), p_note, p_base_version,
    encode(digest(p_data::text, 'sha256'), 'hex'), previous_hash, p_user_id
  ) RETURNING * INTO version_row;

  UPDATE public.documents_metadata
  SET confidence_score = p_computed_score,
      extraction_status = CASE WHEN p_version_kind IN ('edit', 'restore') THEN 'needs_reapproval' ELSE 'ai_extracted' END,
      current_extraction_version = next_version,
      extraction_schema_version = p_schema_version,
      status = 'Extracted',
      updated_at = now()
  WHERE id = p_document_id;

  INSERT INTO public.extraction_events (document_id, client_id, version_number, event, actor_type, actor_id, details)
  VALUES (p_document_id, document_row.client_id, next_version, p_version_kind || '_version_created', 'ca', p_user_id,
          jsonb_build_object('changed_field_count', changed_count, 'computed_score', p_computed_score));
  INSERT INTO public.document_file_activity (
    document_id, client_id, user_id, operation, file_name, version_number,
    changed_field_count, changed_field_paths, note, status
  ) VALUES (
    p_document_id, document_row.client_id, p_user_id, p_version_kind || '_version_created',
    document_row.file_name, next_version, changed_count, COALESCE(p_changed_field_paths, '[]'::jsonb), p_note, 'completed'
  );
  RETURN version_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_extraction_version(
  p_user_id uuid,
  p_document_id uuid,
  p_version_number integer
)
RETURNS public.extraction_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_row public.documents_metadata%ROWTYPE;
  version_row public.extraction_versions%ROWTYPE;
BEGIN
  SELECT d.* INTO document_row
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  WHERE d.id = p_document_id AND c.user_id = p_user_id
    AND d.deletion_requested_at IS NULL
  FOR UPDATE OF d, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document was not found in your workspace.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO version_row FROM public.extraction_versions
  WHERE document_id = p_document_id AND version_number = p_version_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extraction version was not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_version_number <> document_row.current_extraction_version THEN
    RAISE EXCEPTION 'Only the current extraction version can be approved.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.documents_metadata
  SET approved_extraction_version = p_version_number,
      extraction_status = 'approved',
      status = 'Verified',
      verified_by = p_user_id::text,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_document_id;
  INSERT INTO public.extraction_events (document_id, client_id, version_number, event, actor_type, actor_id)
  VALUES (p_document_id, document_row.client_id, p_version_number, 'approved', 'ca', p_user_id);
  RETURN version_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_extraction_version(uuid, uuid, text, jsonb, numeric, numeric, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_extraction_version(uuid, uuid, text, jsonb, numeric, numeric, text, integer, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.record_document_file_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_extraction_version(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_extraction_version(uuid, uuid, integer) TO service_role;
