-- Additive repair for deployments created from extraction_versioning.sql before
-- the pgcrypto digest call was explicitly qualified. Keep this migration after
-- extraction_versioning.sql and preserve the public function signature.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.extraction_versions
  ADD COLUMN IF NOT EXISTS source_data jsonb;

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
+
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


-- Verification (run against staging after applying this migration):
-- SELECT encode(extensions.digest(convert_to('{"probe":1}'::text, 'UTF8'), 'sha256'), 'hex');
-- SELECT pg_get_functiondef('public.save_extraction_version(uuid,uuid,text,jsonb,numeric,numeric,text,integer,text,jsonb)'::regprocedure);
