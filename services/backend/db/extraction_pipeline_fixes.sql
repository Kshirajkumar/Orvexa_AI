-- Migration: extraction_pipeline_fixes.sql
-- Description: Comprehensive live database fix for Orvexa AI extraction pipeline:
-- 1. Explicitly qualified pgcrypto extensions.digest schema qualification
-- 2. Added source_data column to extraction_versions table
-- 3. Created extraction_runs audit table and foreign key constraints
-- 4. Added usage_source column to ai_usage_log
-- 5. Implemented increment_client_ai_calls and increment_client_docs RPCs
-- 6. Implemented save_extraction_version, restore_extraction_version, and approve_extraction_data RPCs
-- 7. Revoked execute permissions on internal SECURITY DEFINER functions FROM PUBLIC, anon, authenticated

-- Ensure pgcrypto lives in extensions schema
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Add usage_source to ai_usage_log
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS usage_source text NOT NULL DEFAULT 'unknown';

-- 2. Add source_data to extraction_versions
ALTER TABLE public.extraction_versions
  ADD COLUMN IF NOT EXISTS source_data jsonb;

-- 3. Durable extraction attempts table
CREATE TABLE IF NOT EXISTS public.extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('gemini', 'openrouter_local')),
  model text,
  prompt_version text NOT NULL DEFAULT 'extraction-prompt-v1',
  schema_version text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  provider_request_id text,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd numeric(12,8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  usage_source text NOT NULL DEFAULT 'unknown' CHECK (usage_source IN ('provider_response', 'client_reported', 'unknown')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_runs_document_idx
  ON public.extraction_runs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS extraction_runs_user_idx
  ON public.extraction_runs (user_id, created_at DESC);

ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extraction_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.extraction_runs TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extraction_versions_run_fk'
  ) THEN
    ALTER TABLE public.extraction_versions
      ADD CONSTRAINT extraction_versions_run_fk
      FOREIGN KEY (extraction_run_id) REFERENCES public.extraction_runs(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- 4. Counter increment RPCs for client stats
CREATE OR REPLACE FUNCTION public.increment_client_ai_calls(cid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.clients
  SET total_ai_calls = COALESCE(total_ai_calls, 0) + 1,
      updated_at = now()
  WHERE id = cid;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_client_ai_calls(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_client_ai_calls(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.increment_client_docs(cid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.clients
  SET total_docs = COALESCE(total_docs, 0) + 1,
      updated_at = now()
  WHERE id = cid;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_client_docs(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_client_docs(uuid) TO service_role;

-- 5. Versioning RPC: save_extraction_version with explicit extensions.digest qualification
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
    changed_field_paths, note, base_version, content_sha256, previous_sha256, extraction_run_id, source_data, created_by
  ) VALUES (
    p_document_id, document_row.client_id, next_version, p_version_kind, p_data,
    p_provider_score, p_computed_score, p_schema_version, changed_count,
    COALESCE(p_changed_field_paths, '[]'::jsonb), p_note, p_base_version,
    encode(
      extensions.digest(convert_to(p_data::text, 'UTF8'), 'sha256'),
      'hex'
    ), previous_hash, NULLIF(p_data->>'extraction_run_id', '')::uuid, p_data->'source_data', p_user_id
  ) RETURNING * INTO version_row;

  UPDATE public.documents_metadata
  SET confidence_score = p_computed_score,
      extraction_status = CASE WHEN p_version_kind IN ('edit', 'restore') THEN 'needs_reapproval' ELSE 'ai_extracted' END,
      current_extraction_version = next_version,
      extraction_schema_version = p_schema_version,
      status = 'Extracted',
      updated_at = now()
  WHERE id = p_document_id AND client_id = document_row.client_id;

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

REVOKE ALL ON FUNCTION public.save_extraction_version(uuid, uuid, text, jsonb, numeric, numeric, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_extraction_version(uuid, uuid, text, jsonb, numeric, numeric, text, integer, text, jsonb) TO service_role;

-- 6. Atomically create a corrected immutable version, mirror its source data, and approve it.
CREATE OR REPLACE FUNCTION public.approve_extraction_data(
  p_user_id uuid,
  p_document_id uuid,
  p_envelope jsonb,
  p_provider_score numeric,
  p_computed_score numeric,
  p_schema_version text,
  p_base_version integer,
  p_changed_field_paths jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL
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
  IF document_row.current_extraction_version IS DISTINCT FROM p_base_version THEN
    RAISE EXCEPTION 'A newer extraction version already exists.' USING ERRCODE = '40001';
  END IF;
  IF p_envelope->'source_data' IS NULL THEN
    RAISE EXCEPTION 'Corrected extraction data is missing from the version envelope.' USING ERRCODE = '22023';
  END IF;

  version_row := public.save_extraction_version(
    p_user_id, p_document_id, 'edit', p_envelope, p_provider_score,
    p_computed_score, p_schema_version, p_base_version, p_note,
    COALESCE(p_changed_field_paths, '[]'::jsonb)
  );

  UPDATE public.documents_metadata
  SET extracted_data = p_envelope->'source_data',
      approved_extraction_version = version_row.version_number,
      extraction_status = 'approved',
      status = 'Verified',
      verified_by = p_user_id::text,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_document_id;
  INSERT INTO public.extraction_events (document_id, client_id, version_number, event, actor_type, actor_id)
  VALUES (p_document_id, document_row.client_id, version_row.version_number, 'approved', 'ca', p_user_id);
  RETURN version_row;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_extraction_data(uuid, uuid, jsonb, numeric, numeric, text, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_extraction_data(uuid, uuid, jsonb, numeric, numeric, text, integer, jsonb, text) TO service_role;

-- 7. Restore prior extraction version RPC
CREATE OR REPLACE FUNCTION public.restore_extraction_version(
  p_user_id uuid,
  p_document_id uuid,
  p_source_version integer,
  p_expected_current_version integer,
  p_note text DEFAULT NULL
)
RETURNS public.extraction_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_row public.documents_metadata%ROWTYPE;
  source_row public.extraction_versions%ROWTYPE;
  restored_row public.extraction_versions%ROWTYPE;
BEGIN
  SELECT d.* INTO document_row
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  WHERE d.id = p_document_id AND c.user_id = p_user_id
    AND d.deletion_requested_at IS NULL
  FOR UPDATE OF d, c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document was not found in your workspace.' USING ERRCODE = 'P0002'; END IF;

  IF p_expected_current_version IS NOT NULL
     AND COALESCE(document_row.current_extraction_version, 0) <> p_expected_current_version THEN
    RAISE EXCEPTION 'A newer extraction version already exists.' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO source_row
  FROM public.extraction_versions
  WHERE document_id = p_document_id AND version_number = p_source_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'The extraction version was not found.' USING ERRCODE = 'P0002'; END IF;
  IF source_row.source_data IS NULL THEN
    RAISE EXCEPTION 'This legacy extraction version cannot be restored because its source data was not retained.' USING ERRCODE = '22023';
  END IF;

  SELECT public.save_extraction_version(
    p_user_id,
    p_document_id,
    'restore',
    source_row.data,
    source_row.provider_score,
    source_row.computed_score,
    source_row.schema_version,
    document_row.current_extraction_version,
    COALESCE(p_note, 'Restored from extraction version ' || p_source_version),
    '[]'::jsonb
  ) INTO restored_row;

  UPDATE public.documents_metadata
  SET extracted_data = source_row.source_data,
      updated_at = now()
  WHERE id = p_document_id AND client_id = document_row.client_id;

  RETURN restored_row;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_extraction_version(uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_extraction_version(uuid, uuid, integer, integer, text) TO service_role;

-- 8. Revoke execute on internal SECURITY DEFINER functions from PUBLIC, anon, and authenticated
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_client_notification') THEN
    REVOKE ALL ON FUNCTION public.create_client_notification() FROM PUBLIC, anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_document_notification') THEN
    REVOKE ALL ON FUNCTION public.create_document_notification() FROM PUBLIC, anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_telegram_message_notification') THEN
    REVOKE ALL ON FUNCTION public.create_telegram_message_notification() FROM PUBLIC, anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'generate_taxflow_ca_code') THEN
    REVOKE ALL ON FUNCTION public.generate_taxflow_ca_code() FROM PUBLIC, anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'generate_taxflow_client_code') THEN
    REVOKE ALL ON FUNCTION public.generate_taxflow_client_code() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;
