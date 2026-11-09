-- Apply before deploying the cloud-only document API.
-- Existing vault_path values remain available for the one-time data migration.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('taxflow-intake', 'taxflow-intake', FALSE, 20971520)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit;

ALTER TABLE public.documents_metadata
  ALTER COLUMN vault_path DROP NOT NULL;

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_category_check;
ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_category_check
  CHECK (category IN ('GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Extracted', 'Generated'));

ALTER TABLE public.documents_metadata
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

CREATE INDEX IF NOT EXISTS documents_metadata_cloud_object_idx
  ON public.documents_metadata (storage_bucket, storage_object_path)
  WHERE storage_object_path IS NOT NULL;

DROP FUNCTION IF EXISTS public.list_pending_document_sync(UUID, UUID, INTEGER);
DROP TABLE IF EXISTS public.document_sync_receipts;
DROP INDEX IF EXISTS public.documents_metadata_pending_local_sync_idx;

NOTIFY pgrst, 'reload schema';
