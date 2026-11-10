CREATE TABLE IF NOT EXISTS public.invoice_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_key text,
  invoice_number text,
  vendor_key text,
  vendor_name text,
  vendor_gstin text,
  approved_data jsonb,
  latest_source_document_id uuid REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  source_file_sha256 text,
  export_document_id uuid,
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  status text NOT NULL DEFAULT 'pending_export'
    CHECK (status IN ('pending_export', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_records_client_key_idx
  ON public.invoice_records (client_id, invoice_key)
  WHERE invoice_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_records_user_client_idx
  ON public.invoice_records (user_id, client_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_records_export_document_idx
  ON public.invoice_records (export_document_id)
  WHERE export_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_record_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_record_id uuid NOT NULL REFERENCES public.invoice_records(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  source_file_sha256 text,
  approved_data jsonb NOT NULL,
  reviewed_by text NOT NULL,
  export_document_id uuid,
  export_file_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_record_id, version_number),
  UNIQUE (source_document_id)
);

CREATE INDEX IF NOT EXISTS invoice_record_versions_client_sha_idx
  ON public.invoice_record_versions (client_id, source_file_sha256)
  WHERE source_file_sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_review_requests (
  document_id uuid PRIMARY KEY REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_record_id uuid NOT NULL REFERENCES public.invoice_records(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('create', 'update')),
  reviewed_data jsonb NOT NULL,
  invoice_key text,
  source_file_sha256 text,
  export_document_id uuid NOT NULL,
  export_file_version_id uuid,
  status text NOT NULL DEFAULT 'pending_export'
    CHECK (status IN ('pending_export', 'completed')),
  reviewed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS invoice_review_requests_pending_idx
  ON public.invoice_review_requests (user_id, created_at)
  WHERE status = 'pending_export';
CREATE INDEX IF NOT EXISTS invoice_review_requests_client_idx
  ON public.invoice_review_requests (client_id);
CREATE INDEX IF NOT EXISTS invoice_review_requests_pending_invoice_idx
  ON public.invoice_review_requests (invoice_record_id)
  WHERE status = 'pending_export';

ALTER TABLE public.invoice_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_record_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_review_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_records, public.invoice_record_versions,
  public.invoice_review_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_records,
  public.invoice_record_versions, public.invoice_review_requests TO service_role;

INSERT INTO public.invoice_records (
  user_id, client_id, invoice_key, invoice_number, vendor_key, vendor_name,
  vendor_gstin, approved_data, latest_source_document_id, source_file_sha256,
  current_version, status, created_at, updated_at
)
SELECT
  c.user_id,
  d.client_id,
  CASE
    WHEN NULLIF(regexp_replace(upper(COALESCE(NULLIF(btrim(d.extracted_data->>'vendor_gstin'), ''), d.extracted_data->>'vendor_name', '')), '[^A-Z0-9]', '', 'g'), '') IS NOT NULL
      AND NULLIF(regexp_replace(upper(COALESCE(d.extracted_data->>'invoice_number', '')), '[^A-Z0-9]', '', 'g'), '') IS NOT NULL
    THEN regexp_replace(upper(COALESCE(NULLIF(btrim(d.extracted_data->>'vendor_gstin'), ''), d.extracted_data->>'vendor_name', '')), '[^A-Z0-9]', '', 'g')
      || ':' || regexp_replace(upper(d.extracted_data->>'invoice_number'), '[^A-Z0-9]', '', 'g')
    ELSE NULL
  END,
  d.extracted_data->>'invoice_number',
  NULLIF(regexp_replace(upper(COALESCE(NULLIF(btrim(d.extracted_data->>'vendor_gstin'), ''), d.extracted_data->>'vendor_name', '')), '[^A-Z0-9]', '', 'g'), ''),
  d.extracted_data->>'vendor_name',
  d.extracted_data->>'vendor_gstin',
  d.extracted_data,
  d.id,
  d.file_sha256,
  1,
  'approved',
  COALESCE(d.verified_at, d.created_at, now()),
  COALESCE(d.updated_at, d.verified_at, d.created_at)
FROM public.documents_metadata d
JOIN public.clients c ON c.id = d.client_id
WHERE d.category = 'GST'
  AND d.status = 'Verified'
  AND d.extracted_data IS NOT NULL
  AND c.user_id IS NOT NULL
  AND d.source <> 'Telegram'
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_records r WHERE r.latest_source_document_id = d.id
  );

INSERT INTO public.invoice_record_versions (
  invoice_record_id, version_number, client_id, source_document_id,
  source_file_sha256, approved_data, reviewed_by, created_at
)
SELECT
  r.id, 1, r.client_id, r.latest_source_document_id, r.source_file_sha256,
  r.approved_data, COALESCE(d.verified_by, 'Existing verified invoice'),
  COALESCE(d.verified_at, d.created_at)
FROM public.invoice_records r
JOIN public.documents_metadata d ON d.id = r.latest_source_document_id
WHERE r.current_version = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_record_versions v WHERE v.invoice_record_id = r.id
  );

CREATE OR REPLACE FUNCTION public.begin_invoice_review(
  p_user_id uuid,
  p_document_id uuid,
  p_reviewed_data jsonb,
  p_existing_invoice_id uuid DEFAULT NULL,
  p_reviewed_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_row public.documents_metadata%ROWTYPE;
  request_row public.invoice_review_requests%ROWTYPE;
  invoice_row public.invoice_records%ROWTYPE;
  duplicate_row public.invoice_records%ROWTYPE;
  vendor_value text;
  vendor_key_value text;
  invoice_number_value text;
  invoice_number_key text;
  invoice_key_value text;
  export_document_id_value uuid;
  export_file_version_id_value uuid;
  action_value text;
  reviewer_value text;
  pending_review_exists boolean;
  exact_duplicate_found boolean := false;
BEGIN
  SELECT d.*
  INTO document_row
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  WHERE d.id = p_document_id
    AND c.user_id = p_user_id
    AND c.deletion_requested_at IS NULL
    AND d.deletion_requested_at IS NULL
    AND d.source <> 'Telegram'
    AND d.category = 'GST'
    AND d.status IN ('Extracted', 'Verified')
  FOR UPDATE OF c, d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invoice is not available for review.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO request_row
  FROM public.invoice_review_requests
  WHERE document_id = p_document_id
    AND user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', request_row.status,
      'action', request_row.action,
      'documentId', request_row.document_id,
      'invoiceRecordId', request_row.invoice_record_id,
      'exportDocumentId', request_row.export_document_id,
      'exportFileVersionId', request_row.export_file_version_id,
      'clientId', request_row.client_id,
      'createdAt', request_row.created_at,
      'reviewedBy', request_row.reviewed_by,
      'reviewedData', request_row.reviewed_data
    );
  END IF;

  IF jsonb_typeof(p_reviewed_data) <> 'object' THEN
    RAISE EXCEPTION 'Reviewed invoice data must be a JSON object.' USING ERRCODE = '22023';
  END IF;

  vendor_value := COALESCE(NULLIF(btrim(p_reviewed_data->>'vendor_gstin'), ''), p_reviewed_data->>'vendor_name', '');
  vendor_key_value := NULLIF(regexp_replace(upper(btrim(vendor_value)), '[^A-Z0-9]', '', 'g'), '');
  invoice_number_value := NULLIF(btrim(p_reviewed_data->>'invoice_number'), '');
  invoice_number_key := NULLIF(regexp_replace(upper(COALESCE(invoice_number_value, '')), '[^A-Z0-9]', '', 'g'), '');
  invoice_key_value := CASE
    WHEN vendor_key_value IS NOT NULL AND invoice_number_key IS NOT NULL
      THEN vendor_key_value || ':' || invoice_number_key
    ELSE NULL
  END;
  reviewer_value := COALESCE(NULLIF(left(btrim(p_reviewed_by), 255), ''), p_user_id::text);

  IF document_row.file_sha256 IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(document_row.client_id::text),
      hashtext('sha256:' || document_row.file_sha256)
    );
  END IF;
  IF invoice_key_value IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(document_row.client_id::text),
      hashtext('invoice:' || invoice_key_value)
    );
  END IF;

  IF document_row.file_sha256 IS NOT NULL THEN
    SELECT r.* INTO duplicate_row
    FROM public.invoice_record_versions v
    JOIN public.invoice_records r ON r.id = v.invoice_record_id
    WHERE v.client_id = document_row.client_id
      AND v.source_file_sha256 = document_row.file_sha256
      AND r.status = 'approved'
    ORDER BY v.created_at DESC
    LIMIT 1;
    IF FOUND THEN
      exact_duplicate_found := true;
      IF p_existing_invoice_id IS NULL THEN
        RETURN jsonb_build_object(
          'status', 'duplicate_exact',
          'invoice', jsonb_build_object(
            'id', duplicate_row.id,
            'invoiceNumber', duplicate_row.invoice_number,
            'vendorName', duplicate_row.vendor_name,
            'vendorGstin', duplicate_row.vendor_gstin,
            'data', duplicate_row.approved_data
          )
        );
      END IF;
    END IF;
  END IF;

  IF document_row.file_sha256 IS NOT NULL THEN
    PERFORM 1
    FROM public.invoice_review_requests
    WHERE client_id = document_row.client_id
      AND source_file_sha256 = document_row.file_sha256
      AND status = 'pending_export'
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'review_in_progress');
    END IF;
  END IF;

  IF p_existing_invoice_id IS NOT NULL THEN
    SELECT * INTO invoice_row
    FROM public.invoice_records
    WHERE id = p_existing_invoice_id
      AND client_id = document_row.client_id
      AND user_id = p_user_id
      AND status = 'approved'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected existing invoice is no longer available.' USING ERRCODE = 'P0002';
    END IF;
    IF invoice_key_value IS NOT NULL AND invoice_row.invoice_key IS NOT NULL
      AND invoice_key_value <> invoice_row.invoice_key THEN
      RAISE EXCEPTION 'The reviewed invoice does not match the selected existing invoice.' USING ERRCODE = '22023';
    END IF;
    IF exact_duplicate_found AND duplicate_row.id <> invoice_row.id
      AND invoice_key_value IS DISTINCT FROM invoice_row.invoice_key THEN
      RAISE EXCEPTION 'The uploaded file matches a different invoice.' USING ERRCODE = '22023';
    END IF;
    IF NOT exact_duplicate_found AND invoice_key_value IS NULL
      AND invoice_row.invoice_key IS NOT NULL THEN
      RAISE EXCEPTION 'The reviewed invoice needs a supplier and invoice number to update an existing invoice.' USING ERRCODE = '22023';
    END IF;
    IF NOT exact_duplicate_found AND invoice_key_value IS NOT NULL
      AND invoice_row.invoice_key IS NULL THEN
      RAISE EXCEPTION 'The selected invoice cannot be matched safely.' USING ERRCODE = '22023';
    END IF;
    action_value := 'update';
    SELECT EXISTS (
      SELECT 1 FROM public.invoice_review_requests
      WHERE invoice_record_id = invoice_row.id AND status = 'pending_export'
    ) INTO pending_review_exists;
    IF pending_review_exists THEN
      RETURN jsonb_build_object('status', 'review_in_progress');
    END IF;
    export_document_id_value := COALESCE(invoice_row.export_document_id, gen_random_uuid());
    IF invoice_row.export_document_id IS NOT NULL THEN
      export_file_version_id_value := gen_random_uuid();
    END IF;
  ELSE
    IF invoice_key_value IS NOT NULL THEN
      SELECT * INTO duplicate_row
      FROM public.invoice_records
      WHERE client_id = document_row.client_id
        AND invoice_key = invoice_key_value
        AND status = 'approved'
      ORDER BY updated_at DESC
      LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'duplicate_match',
          'invoice', jsonb_build_object(
            'id', duplicate_row.id,
            'invoiceNumber', duplicate_row.invoice_number,
            'vendorName', duplicate_row.vendor_name,
            'vendorGstin', duplicate_row.vendor_gstin,
            'data', duplicate_row.approved_data
          )
        );
      END IF;

      SELECT * INTO duplicate_row
      FROM public.invoice_records
      WHERE client_id = document_row.client_id
        AND invoice_key = invoice_key_value
        AND status = 'pending_export'
      ORDER BY created_at DESC
      LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object('status', 'review_in_progress');
      END IF;
    END IF;

    action_value := 'create';
    INSERT INTO public.invoice_records (
      user_id, client_id, invoice_key, invoice_number, vendor_key,
      vendor_name, vendor_gstin, export_document_id, status
    )
    VALUES (
      p_user_id, document_row.client_id, invoice_key_value, invoice_number_value,
      vendor_key_value, p_reviewed_data->>'vendor_name',
      p_reviewed_data->>'vendor_gstin', gen_random_uuid(), 'pending_export'
    )
    RETURNING * INTO invoice_row;
    export_document_id_value := invoice_row.export_document_id;
  END IF;

  INSERT INTO public.invoice_review_requests (
    document_id, user_id, client_id, invoice_record_id, action, reviewed_data,
    invoice_key, source_file_sha256, export_document_id,
    export_file_version_id, reviewed_by
  )
  VALUES (
    p_document_id, p_user_id, document_row.client_id, invoice_row.id,
    action_value, p_reviewed_data, invoice_key_value, document_row.file_sha256,
    export_document_id_value, export_file_version_id_value, reviewer_value
  )
  RETURNING * INTO request_row;

  RETURN jsonb_build_object(
    'status', request_row.status,
    'action', request_row.action,
    'documentId', request_row.document_id,
    'invoiceRecordId', request_row.invoice_record_id,
    'exportDocumentId', request_row.export_document_id,
    'exportFileVersionId', request_row.export_file_version_id,
    'clientId', request_row.client_id,
    'createdAt', request_row.created_at,
    'reviewedBy', request_row.reviewed_by,
    'reviewedData', request_row.reviewed_data
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_invoice_export_version(
  p_user_id uuid,
  p_reservation_id uuid,
  p_document_id uuid,
  p_version_id uuid,
  p_storage_bucket text,
  p_storage_object_path text,
  p_file_name text,
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
  SELECT * INTO version_row
  FROM public.document_versions
  WHERE id = p_version_id AND document_id = p_document_id;
  IF FOUND THEN
    IF version_row.file_sha256 <> p_file_sha256 OR version_row.storage_object_path <> p_storage_object_path THEN
      RAISE EXCEPTION 'The invoice export version does not match this save attempt.' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.document_upload_reservations
    WHERE id = p_reservation_id AND owner_user_id = p_user_id;
    RETURN version_row;
  END IF;

  SELECT d.* INTO document_row
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
    AND d.category = 'Extracted'
    AND d.source <> 'Telegram'
    AND d.status IN ('Extracted', 'Verified')
    AND r.expires_at > now()
  FOR UPDATE OF d, c, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invoice export upload reservation was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_storage_bucket <> document_row.storage_bucket
    OR left(p_storage_object_path, length(
      p_user_id::text || '/' || document_row.client_id::text || '/documents/'
        || p_document_id::text || '/' || p_version_id::text || '_'
    )) <> (
      p_user_id::text || '/' || document_row.client_id::text || '/documents/'
        || p_document_id::text || '/' || p_version_id::text || '_'
    ) THEN
    RAISE EXCEPTION 'Invoice export version path is outside the document storage namespace.';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
  FROM public.document_versions WHERE document_id = p_document_id;

  INSERT INTO public.document_versions (
    id, document_id, version_number, storage_bucket, storage_object_path,
    file_name, file_type, file_size_kb, file_sha256, mime_type, created_by
  )
  SELECT
    p_version_id, p_document_id, next_version, p_storage_bucket,
    p_storage_object_path, p_file_name, 'OTHER', p_file_size_kb,
    p_file_sha256, p_mime_type, r.created_by
  FROM public.document_upload_reservations r
  WHERE r.id = p_reservation_id
  RETURNING * INTO version_row;

  UPDATE public.documents_metadata
  SET storage_bucket = p_storage_bucket,
      storage_object_path = p_storage_object_path,
      file_name = p_file_name,
      file_type = 'OTHER',
      file_size_kb = p_file_size_kb,
      file_sha256 = p_file_sha256,
      mime_type = p_mime_type,
      status = 'Verified',
      updated_at = now()
  WHERE id = p_document_id;

  DELETE FROM public.document_upload_reservations WHERE id = p_reservation_id;
  RETURN version_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_invoice_review(
  p_user_id uuid,
  p_document_id uuid,
  p_export_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  request_row public.invoice_review_requests%ROWTYPE;
  invoice_row public.invoice_records%ROWTYPE;
  document_row public.documents_metadata%ROWTYPE;
  next_version integer;
  export_path_prefix text;
BEGIN
  SELECT * INTO request_row
  FROM public.invoice_review_requests
  WHERE document_id = p_document_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No invoice approval is waiting for completion.' USING ERRCODE = 'P0002';
  END IF;

  IF request_row.status = 'completed' THEN
    SELECT * INTO invoice_row FROM public.invoice_records WHERE id = request_row.invoice_record_id;
    RETURN jsonb_build_object(
      'status', 'completed',
      'invoiceRecordId', invoice_row.id,
      'invoiceVersion', invoice_row.current_version,
      'exportDocumentId', invoice_row.export_document_id,
      'reviewedData', invoice_row.approved_data
    );
  END IF;

  SELECT d.* INTO document_row
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  WHERE d.id = p_document_id
    AND d.client_id = request_row.client_id
    AND c.user_id = p_user_id
    AND c.deletion_requested_at IS NULL
    AND d.deletion_requested_at IS NULL
  FOR UPDATE OF d, c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source invoice is no longer available.' USING ERRCODE = 'P0002';
  END IF;

  IF request_row.export_file_version_id IS NULL THEN
    export_path_prefix := p_user_id::text || '/' || request_row.client_id::text || '/'
      || to_char(request_row.created_at AT TIME ZONE 'UTC', 'YYYY') || '/'
      || to_char(request_row.created_at AT TIME ZONE 'UTC', 'FMMonth') || '/Extracted/'
      || request_row.export_document_id::text || '_';
    PERFORM 1
    FROM public.documents_metadata d
    WHERE d.id = request_row.export_document_id
      AND d.client_id = request_row.client_id
      AND d.category = 'Extracted'
      AND d.deletion_requested_at IS NULL
      AND d.file_sha256 = p_export_sha256
      AND left(d.storage_object_path, length(export_path_prefix)) = export_path_prefix;
  ELSE
    export_path_prefix := p_user_id::text || '/' || request_row.client_id::text
      || '/documents/' || request_row.export_document_id::text || '/'
      || request_row.export_file_version_id::text || '_';
    PERFORM 1
    FROM public.document_versions v
    JOIN public.documents_metadata d ON d.id = v.document_id
    WHERE v.id = request_row.export_file_version_id
      AND v.document_id = request_row.export_document_id
      AND v.file_sha256 = p_export_sha256
      AND v.storage_bucket = d.storage_bucket
      AND d.client_id = request_row.client_id
      AND d.category = 'Extracted'
      AND d.deletion_requested_at IS NULL
      AND left(v.storage_object_path, length(export_path_prefix)) = export_path_prefix;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The private invoice export has not been saved yet.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoice_records
  WHERE id = request_row.invoice_record_id
    AND user_id = p_user_id
    AND client_id = request_row.client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invoice record is no longer available.' USING ERRCODE = 'P0002';
  END IF;

  next_version := invoice_row.current_version + 1;
  UPDATE public.invoice_records
  SET invoice_key = request_row.invoice_key,
      invoice_number = NULLIF(btrim(request_row.reviewed_data->>'invoice_number'), ''),
      vendor_key = NULLIF(regexp_replace(upper(COALESCE(NULLIF(btrim(request_row.reviewed_data->>'vendor_gstin'), ''), request_row.reviewed_data->>'vendor_name', '')), '[^A-Z0-9]', '', 'g'), ''),
      vendor_name = request_row.reviewed_data->>'vendor_name',
      vendor_gstin = request_row.reviewed_data->>'vendor_gstin',
      approved_data = request_row.reviewed_data,
      latest_source_document_id = request_row.document_id,
      source_file_sha256 = request_row.source_file_sha256,
      export_document_id = request_row.export_document_id,
      current_version = next_version,
      status = 'approved',
      updated_at = now()
  WHERE id = invoice_row.id
  RETURNING * INTO invoice_row;

  INSERT INTO public.invoice_record_versions (
    invoice_record_id, version_number, client_id, source_document_id,
    source_file_sha256, approved_data, reviewed_by, export_document_id,
    export_file_version_id
  )
  VALUES (
    invoice_row.id, next_version, invoice_row.client_id, request_row.document_id,
    request_row.source_file_sha256, request_row.reviewed_data, request_row.reviewed_by,
    request_row.export_document_id, request_row.export_file_version_id
  );

  UPDATE public.documents_metadata
  SET status = 'Verified',
      extracted_data = request_row.reviewed_data,
      verified_by = request_row.reviewed_by,
      verified_at = now(),
      updated_at = now()
  WHERE id = request_row.document_id;

  UPDATE public.invoice_review_requests
  SET status = 'completed', completed_at = now()
  WHERE document_id = p_document_id;

  RETURN jsonb_build_object(
    'status', 'completed',
    'action', request_row.action,
    'invoiceRecordId', invoice_row.id,
    'invoiceVersion', invoice_row.current_version,
    'exportDocumentId', invoice_row.export_document_id,
    'reviewedData', invoice_row.approved_data
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_invoice_review(uuid, uuid, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_invoice_export_version(uuid, uuid, uuid, uuid, text, text, text, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_invoice_review(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_invoice_review(uuid, uuid, jsonb, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.register_invoice_export_version(uuid, uuid, uuid, uuid, text, text, text, numeric, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_invoice_review(uuid, uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
